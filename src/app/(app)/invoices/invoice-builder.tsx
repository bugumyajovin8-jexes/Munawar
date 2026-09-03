"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Send, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate, formatMoney, todayLocal } from "@/lib/format";
import { invoiceTotals, lineSubtotal, lineTotal, lineVat, num } from "@/lib/money";
import { cn } from "@/lib/utils";
import { submit } from "@/lib/offline/outbox";
import { mergeById, useAll, useRelated } from "@/lib/offline/local";
import { applyLocal, removeLocal, sync } from "@/lib/offline/sync";
import type { Row } from "@/lib/offline/db";
import { invoiceItemRows, invoiceRow } from "@/lib/offline/optimistic";
import { formatDocumentNumber } from "@/lib/offline/derive";
import { newId } from "@/lib/offline/outbox";
import { deviceId, returnNumber, takeNumber } from "@/lib/offline/numbers";
import { useOnline } from "@/lib/offline/hooks";
import { BranchDialog } from "../customers/branch-dialog";
import { CustomerDialog } from "../customers/customer-dialog";
import { ProductDialog } from "../products/product-dialog";
import { ProductPicker } from "./product-picker";
import { saveAndIssue } from "./actions";
import type {
  Customer,
  CustomerBranch,
  Invoice,
  InvoiceItem,
  Product,
  VatMode,
} from "@/lib/types";

type Line = {
  key: string;
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

const TERM_PRESETS = [15, 30, 60, 90];


function blankLine(): Line {
  return {
    key: crypto.randomUUID(),
    product_id: null,
    description: "",
    unit: "pcs",
    qty: 1,
    unit_price: 0,
    vat_applicable: true,
  };
}

export function InvoiceBuilder({
  customers: serverCustomers = [],
  products: serverProducts = [],
  defaultTermsDays,
  vatRate,
  invoice,
  items,
  initialCustomerId,
}: {
  /**
   * A server-rendered starting list, where there is one.
   *
   * Optional, because /invoices/new no longer fetches either: the mirror
   * already holds every customer and product, and reading them here was the
   * last thing keeping that route on the server. The edit screen still passes
   * them, since it is loading one specific draft anyway.
   */
  customers?: Customer[];
  products?: Product[];
  defaultTermsDays: number;
  vatRate: number;
  invoice?: Invoice;
  items?: InvoiceItem[];
  initialCustomerId?: string;
}) {

  /*
   * Pickers read this device's mirror, not the props.
   *
   * The props come from a server render, which means a customer added with no
   * signal was invisible here until it synced — you could create someone and
   * then be unable to invoice them, which is exactly the complaint this whole
   * piece of work started from. The mirror has them the moment the dialog
   * closes, because the customer dialog writes there before it even attempts
   * the network.
   *
   * The server lists remain the fallback for the one case the mirror cannot
   * cover: a first-ever load, before the first sync has finished.
   */
  const mirrorCustomers = useAll<Customer>("customers");
  const mirrorProducts = useAll<Product>("products");

  const customers = useMemo(
    () =>
      mergeById(serverCustomers, mirrorCustomers)
        .filter((c) => c.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mirrorCustomers, serverCustomers],
  );

  const products = useMemo(
    () =>
      mergeById(serverProducts, mirrorProducts)
        .filter((p) => p.is_active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mirrorProducts, serverProducts],
  );

  const router = useRouter();
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);

  const [customerId, setCustomerId] = useState<string | null>(
    invoice?.customer_id ?? initialCustomerId ?? null,
  );
  const [orderDate, setOrderDate] = useState(invoice?.order_date ?? todayLocal());
  const [termsDays, setTermsDays] = useState(invoice?.terms_days ?? defaultTermsDays);
  const [vatMode, setVatMode] = useState<VatMode>(invoice?.vat_mode ?? "exclusive");
  /*
   * Held as the typed string, not a number.
   *
   * The field has to be emptiable — backspacing to nothing is how somebody
   * takes a discount off again — and a number state cannot hold "nothing"
   * without becoming 0 and putting a 0 back in the box under the cursor.
   */
  /*
   * The discount box, which has two possible sources and a clear rule about
   * which one wins.
   *
   * A customer can carry a usual discount, and choosing them should put it in
   * the field. But anything typed afterwards belongs to the invoice — clear it
   * and there is no discount, change it and the change stands. Those two
   * behaviours are in tension for exactly as long as one tries to keep them in
   * the same piece of state and copy one into the other.
   *
   * So the edit is stored with the customer it was made for, and the value
   * shown is derived rather than synchronised: an edit for the customer now
   * selected wins, and in every other case the field shows what that customer
   * usually gets. Picking a different customer therefore drops an edit that
   * was about somebody else, without anything having to notice the change and
   * react to it.
   *
   * An existing draft starts as an edit already made, so the figure agreed
   * last week is what reopening it shows — not whatever the customer's record
   * happens to say today.
   */
  const [discountEdit, setDiscountEdit] = useState<
    { forCustomer: string | null; value: string } | null
  >(
    invoice
      ? {
          forCustomer: invoice.customer_id,
          value: invoice.discount_percent ? String(Number(invoice.discount_percent)) : "",
        }
      : null,
  );
  /*
   * Null is head office, and that is a real answer rather than a missing one.
   * A customer with three depots still has a main office to invoice, so the
   * branch is never required — it is offered.
   */
  const [branchId, setBranchId] = useState<string | null>(invoice?.branch_id ?? null);
  /*
   * The name typed into the branch picker when it found nothing, handed to the
   * branch form as its starting point.
   *
   * Creating one happens here rather than on the customer screen for the same
   * reason customers and products can be created here: the moment somebody
   * needs a branch is while they are writing the invoice for it, and sending
   * them away to make one first throws away the work in front of them.
   */
  const [newBranchName, setNewBranchName] = useState<string | null>(null);

  const [customerNotes, setCustomerNotes] = useState(invoice?.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(invoice?.internal_notes ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    items?.length
      ? items.map((i) => ({
          key: crypto.randomUUID(),
          product_id: i.product_id,
          description: i.description,
          unit: i.unit,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price),
          vat_applicable: i.vat_applicable,
        }))
      : [blankLine()],
  );

  const customerOptions: ComboboxOption[] = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.phone_e164 ?? undefined,
        keywords: `${c.phone_e164 ?? ""} ${c.contact_person ?? ""}`,
      })),
    [customers],
  );

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  /*
   * This customer's previously agreed prices, read from the mirror.
   *
   * It used to call the server on every customer selection. Offline that
   * request simply failed — silently, since nothing caught it — and the picker
   * fell back to list prices. Nothing on screen said so, which is the worst
   * possible way to be wrong about a price: the invoice is issued, the
   * customer is charged something other than what was agreed, and the first
   * anybody hears of it is the argument.
   *
   * customer_prices has been mirrored to the device on every sync all along.
   * Nothing was reading it.
   */
  const priceRows = useRelated<{ product_id: string; agreed_price: number | string }>(
    "customerPrices",
    "customer_id",
    customerId,
  );

  const agreedPrices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of priceRows) {
      const price = Number(row.agreed_price);
      if (Number.isFinite(price)) map[row.product_id] = price;
    }
    return map;
  }, [priceRows]);

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    // A branch belongs to one customer, so it cannot survive a change of mind
    // about who is being invoiced — the same reason the TIN is cleared below.
    setBranchId(null);
    // Cleared deliberately: a TIN typed for one customer must never follow a
    // change of mind onto another.
    setCustomerTin("");
    const c = customers.find((x) => x.id === id);
    // Only adopt their terms on a fresh invoice, never overwrite a deliberate
    // choice on one already being edited.
    if (c && !invoice) setTermsDays(c.payment_terms_days);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /**
   * Put a product on the invoice, or add one more of it.
   *
   * Tapping a product already on the invoice increases its quantity rather
   * than creating a second line for the same thing — which is what a person
   * tapping twice means, and what a duplicate line would fail to say.
   */
  function addProduct(product: Product) {
    const existing = lines.find((l) => l.product_id === product.id);
    if (existing) {
      updateLine(existing.key, { qty: num(existing.qty) + 1 });
      return;
    }

    const line: Line = {
      key: newId(),
      product_id: product.id,
      description: product.description?.trim() || product.name,
      unit: product.unit,
      qty: 1,
      // The price this customer was last charged wins over the list price.
      unit_price: agreedPrices[product.id] ?? Number(product.selling_price),
      vat_applicable: product.vat_applicable,
    };

    setLines((prev) => {
      // The starting blank line is a placeholder, not a decision. Replace it
      // rather than leaving an empty row above the first real one.
      const meaningful = prev.filter((l) => l.description.trim() || num(l.qty) > 0);
      return [...meaningful, line];
    });
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  /*
   * Creating a customer or a product without leaving this screen.
   *
   * Realising you need a new one almost always happens while you are looking
   * for it, and sending someone to another page to add it threw away the
   * invoice they were halfway through. The name they typed into the picker is
   * carried into the dialog, and the record they create is selected the moment
   * it is saved — which works offline too, because the id is minted here.
   *
   * `newProductFor` remembers which line asked, since every line has a picker
   * of its own and the answer has to go back to the right one.
   */
  /*
   * A TIN for a customer who has none on file.
   *
   * Asked here rather than sent back to the customer screen, because it is
   * almost always asked for by the person receiving the invoice — "put my TIN
   * on it" — at the moment it is being raised. Whether to keep it is a
   * separate question: somebody buying once for a company they will never
   * invoice again should not become a permanent record to get a valid
   * document, so saving is offered rather than assumed.
   */
  const [customerTin, setCustomerTin] = useState("");
  const [rememberTin, setRememberTin] = useState(true);

  const [pickerOpen, setPickerOpen] = useState(false);

  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState<string | null>(null);

  const chosenCount = lines
    .filter((l) => l.description.trim() && num(l.qty) > 0)
    .reduce((sum, l) => sum + num(l.qty), 0);

  /*
   * Read for whichever customer is selected, so switching customer switches
   * the list without anything having to clear it.
   */
  const branchRows = useRelated<CustomerBranch>(
    "customerBranches",
    "customer_id",
    customerId,
  );

  /*
   * Head office first, then this customer's branches, then whatever has just
   * been typed. A branch that was used once and not kept is inactive and stays
   * off the list, but is still shown while it is the one selected — otherwise
   * reopening that draft would silently lose it.
   */
  /*
   * Head office first, then this customer's branches. One that was retired
   * stays off the list but is still shown while it is the one selected —
   * otherwise reopening an old draft would silently lose its branch.
   */
  const branchOptions: ComboboxOption[] = useMemo(
    () => [
      { value: "", label: "Head office", hint: "No branch" },
      ...branchRows
        .filter((b) => b.is_active || b.id === branchId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          value: b.id,
          label: b.name,
          hint: b.city ?? undefined,
          keywords: `${b.city ?? ""} ${b.contact_person ?? ""}`,
        })),
    ],
    [branchRows, branchId],
  );

  const usualDiscount = Number(selectedCustomer?.default_discount_percent ?? 0);

  const fromCustomerRecord = !(discountEdit && discountEdit.forCustomer === customerId);

  const discountInput = fromCustomerRecord
    ? usualDiscount > 0
      ? String(usualDiscount)
      : ""
    : discountEdit.value;

  /*
   * Clamped to a sane range here as well as in the database, because this is
   * the figure the screen adds up in front of the user. 100 or more is refused
   * rather than clamped — an invoice for nothing is a credit note.
   */
  const discountPercent = Math.min(Math.max(num(discountInput), 0), 99.99);

  const totals = useMemo(
    () => invoiceTotals(lines, vatMode, vatRate, discountPercent),
    [lines, vatMode, vatRate, discountPercent],
  );

  const dueIfIssuedToday = addDays(todayLocal(), termsDays);

  /**
   * Keep the TIN against the customer, if that was asked for.
   *
   * Queued like every other write, so it survives with no signal, and written
   * into the mirror immediately so the field stops being offered the moment it
   * has been answered.
   */
  async function rememberTinIfAsked() {
    const tin = customerTin.trim();
    if (!tin || !rememberTin || !customerId || !selectedCustomer) return;

    await applyLocal("customers", [{ ...selectedCustomer, tin }]);
    await submit({
      kind: "customer.tin",
      label: `TIN · ${selectedCustomer.name}`,
      body: { customerId, tin },
    });
  }

  /**
   * Put the invoice on this device, before the server has seen it.
   *
   * Issuing offline used to reserve a real number and then show nothing: the
   * list stayed empty and the document just promised to a customer could not
   * be printed, because it existed only as a queued operation. The server
   * still owns the arithmetic and the next pull replaces all of this — but the
   * screen no longer has to wait for that to admit the invoice exists.
   */
  async function mirrorInvoice(
    invoiceId: string,
    issued: { number: string; date: string } | null,
  ) {
    const usable = lines.filter((l) => l.description.trim() && num(l.qty) > 0);

    await applyLocal("invoices", [
      invoiceRow({
        id: invoiceId,
        customerId: customerId ?? "",
        number: issued?.number ?? null,
        // The server mints the real DRAFT-000123 reference. Until it does,
        // something readable and stable beats an empty cell in the list.
        draftRef: invoice?.draft_ref ?? `DRAFT-${invoiceId.slice(0, 6).toUpperCase()}`,
        status: issued ? "issued" : "draft",
        orderDate: orderDate,
        invoiceDate: issued?.date ?? null,
        dueDate: issued ? addDays(issued.date, termsDays) : null,
        termsDays,
        vatMode,
        vatRate,
        subtotal: totals.subtotal,
        discountPercent,
        discountAmount: totals.discount,
        branchId,
        /*
         * Snapshotted here as the server does, so a document raised with no
         * signal prints the branch rather than a blank until the next pull.
         * Read from the mirror, which the branch form has already written to —
         * so a branch created seconds ago on a phone with no connection is
         * found here exactly like one that has existed for a year.
         */
        branchName: branchRows.find((b) => b.id === branchId)?.name ?? null,
        vatTotal: totals.vat,
        total: totals.total,
        customerTin: customerTin.trim() || selectedCustomer?.tin || null,
      }),
    ]);

    await applyLocal(
      "invoiceItems",
      invoiceItemRows(
        invoiceId,
        usable.map((l) => ({
          id: l.key,
          product_id: l.product_id,
          description: l.description.trim(),
          unit: l.unit || "pcs",
          qty: num(l.qty),
          unit_price: num(l.unit_price),
          vat_applicable: l.vat_applicable,
          line_subtotal: lineSubtotal(num(l.qty), num(l.unit_price)),
          line_vat: lineVat(num(l.qty), num(l.unit_price), l.vat_applicable, vatRate),
          line_total: lineTotal(num(l.qty), num(l.unit_price), l.vat_applicable, vatRate),
        })),
      ),
    );
  }

  /**
   * Take an optimistically-mirrored invoice back off the device.
   *
   * The lines go too. They are written under the ids of the form's own line
   * keys, and nothing else would ever remove them: tombstones only arrive for
   * rows the server knew about, and the server rejected this one.
   */
  async function unmirrorInvoice(invoiceId: string) {
    const usable = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
    await removeLocal(
      "invoiceItems",
      usable.map((l) => l.key),
    );
    await removeLocal("invoices", invoiceId);
  }

  function buildPayload() {
    return {
      invoice_id: invoice?.id ?? null,
      customer_id: customerId ?? "",
      order_date: orderDate,
      terms_days: termsDays,
      vat_mode: vatMode,
      customer_tin: customerTin.trim() || null,
      customer_notes: customerNotes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      discount_percent: discountPercent,
      branch_id: branchId,
      items: lines
        .filter((l) => l.description.trim() && num(l.qty) > 0)
        .map((l) => ({
          product_id: l.product_id,
          description: l.description.trim(),
          unit: l.unit || "pcs",
          qty: num(l.qty),
          unit_price: num(l.unit_price),
          vat_applicable: l.vat_applicable,
        })),
    };
  }

  function validate(): string | null {
    if (!customerId) return "Choose a customer first.";
    const usable = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
    if (usable.length === 0) return "Add at least one line with a description and quantity.";
    return null;
  }

  function onSaveDraft() {
    const problem = validate();
    if (problem) return toast.error(problem);

    const customerName =
      customers.find((c) => c.id === customerId)?.name ?? "invoice";

    setBusy("draft");
    startTransition(async () => {
      await rememberTinIfAsked();

      const draftId = invoice?.id ?? newId();
      await mirrorInvoice(draftId, null);

      const result = await submit({
        kind: "invoice.draft",
        label: `Draft · ${customerName} · TSh ${formatMoney(totals.total)}`,
        body: { ...buildPayload(), invoice_id: draftId },
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.queued) {
        // No id to open — the database has not seen it yet. The sync panel is
        // where the user can confirm it is safe in the meantime.
        toast.success("Draft saved on this device", {
          description: "It uploads itself as soon as you are back online.",
        });
        router.push("/invoices");
        return;
      }

      toast.success("Saved as draft", {
        description: "Issue it when the goods actually ship.",
      });
      router.push(
        result.data?.invoiceId ? `/invoices/${result.data.invoiceId}` : "/invoices",
      );
    });
  }

  /**
   * Issue with no signal: save the draft under an id this device chose, spend
   * one of its own numbers, and queue both for the server to confirm.
   */
  async function issueFromBlock() {
    const taken = await takeNumber();
    if (!taken) {
      toast.error("No invoice numbers left on this device", {
        description:
          "Save it as a draft — it takes its number the moment you are back online.",
      });
      return;
    }

    await rememberTinIfAsked();

    const invoiceId = invoice?.id ?? newId();
    const payload = { ...buildPayload(), invoice_id: invoiceId };

    // Formatted the same way the database formats it, so the copy handed to
    // the customer and the copy eventually stored name the same document.
    const issuedOn = todayLocal();
    const number = formatDocumentNumber("invoice", taken.year, taken.number);
    await mirrorInvoice(invoiceId, { number, date: issuedOn });

    const draft = await submit({
      kind: "invoice.draft",
      label: `Draft · ${customers.find((c) => c.id === customerId)?.name ?? "invoice"}`,
      body: payload,
    });

    if (!draft.ok) {
      // Nothing was issued, so the number was never used. Putting it back
      // keeps the sequence tight instead of leaving a hole for a failed save,
      // and the optimistic rows go with it — an invoice the server rejected
      // must not linger on the device looking real.
      await returnNumber(taken.number);
      await unmirrorInvoice(invoiceId);
      toast.error(draft.error);
      return;
    }

    const issued = await submit({
      kind: "invoice.issue",
      label: `Issue invoice · ${String(taken.number).padStart(4, "0")}`,
      body: {
        invoiceId,
        deviceId: await deviceId(),
        number: taken.number,
        // Stamped here, so a queue that drains days later cannot re-date the
        // document or push its number into the wrong year.
        issuedOn,
        shipDate: null,
      },
    });

    if (!issued.ok) {
      await returnNumber(taken.number);
      await unmirrorInvoice(invoiceId);
      toast.error(issued.error);
      return;
    }

    toast.success(`Invoice ${number} issued`, {
      description: "Saved on this device — it uploads itself when you have signal.",
    });
    router.push("/invoices");
  }

  function onIssueNow() {
    const problem = validate();
    if (problem) return toast.error(problem);

    /*
     * Offline, the number comes from the block this device was lent in advance.
     *
     * It is still the server that decides: the range was granted by the same
     * row lock that hands out numbers online, and when this reaches /api/sync
     * the number is checked against that grant before anything is booked. So
     * the phone is not minting numbers, it is spending ones already set aside
     * for it — which is what keeps them unique across every device.
     *
     * A device that has run out falls back to a draft. Inventing one would
     * eventually hand two customers the same invoice number.
     */
    if (!online) {
      setBusy("issue");
      void issueFromBlock().finally(() => setBusy(null));
      return;
    }

    setBusy("issue");
    startTransition(async () => {
      /*
       * The one write on this screen that does not go through the outbox, so
       * it is the one that has to handle the network failing by itself.
       *
       * The check above says this device is online; it says nothing about the
       * next two seconds. Walk out of the shop mid-request and the server
       * action rejects — and without this the button would sit on "Issuing…"
       * for ever with nothing said, which is the state that gets pressed
       * again and again.
       */
      try {
        await rememberTinIfAsked();
        const result = await saveAndIssue(buildPayload(), null);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // The server's own row first, so the screen this navigates to has the
        // invoice before it renders rather than a sync interval later.
        if (result.row) await applyLocal("invoices", [result.row as Row]);

        toast.success(`Invoice ${result.number ?? ""} issued`);
        router.push(`/invoices/${result.invoiceId}?issued=1`);

        /*
         * The invoice exists on the server and nowhere else yet.
         *
         * Unlike every other write on this screen this one does not go through
         * the outbox, so nothing has written it to the mirror on the way past
         * — and the screen we have just sent the user to reads the mirror.
         * Without this it sits there until whenever the next scheduled pull
         * comes round, showing an invoice-shaped hole where a document they
         * just created ought to be.
         *
         * Not awaited: the navigation has already started and the detail
         * screen shows its own waiting state until the row lands.
         */
        void sync();
      } catch {
        // The connection went during the request. Nothing was issued, so no
        // number was spent and there is nothing to undo — but the invoice can
        // still be saved, and offline that is exactly what this button does.
        toast.error("Lost the connection while issuing", {
          description: "Nothing was sent. Try again — it will issue on this device instead.",
        });
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Customer &amp; dates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="customer">Customer *</Label>
              <Combobox
                id="customer"
                options={customerOptions}
                value={customerId}
                onChange={handleCustomerChange}
                placeholder="Choose a customer"
                searchPlaceholder="Search name or phone…"
                emptyText="No customer by that name yet."
                onCreate={(typed) => setNewCustomerName(typed)}
                createLabel="New customer"
              />
            </div>

            {/*
              TIN and branch share a row, because they are asked at the same
              moment and about the same person, and stacking them pushed the
              product button — the next thing anybody wants — off the bottom of
              a phone screen.

              Both are plain fields with a line of help underneath rather than
              the tinted box the TIN used to sit in. Side by side, one boxed
              field and one bare one reads as a mistake; the box was carrying
              "this appeared because something is missing", and the help text
              says that in words instead.

              They appear on different conditions — the TIN only for a customer
              who has none on file — so when the TIN is absent the branch
              simply takes the left-hand cell. Holding it on the right would
              leave a gap that looks like a fault rather than a layout.
            */}
            {selectedCustomer && !selectedCustomer.tin && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer_tin">
                  Customer TIN <span className="text-muted-foreground">(optional)</span>
                </Label>
                {/*
                  No autofocus: this appears on its own rather than because it
                  was asked for, and stealing the cursor would open the phone
                  keyboard over the rest of the form every time a customer is
                  picked.
                */}
                <Input
                  id="customer_tin"
                  value={customerTin}
                  onChange={(e) => setCustomerTin(e.target.value)}
                  inputMode="numeric"
                  placeholder="123-456-789"
                />
                {customerTin.trim() ? (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={rememberTin}
                      onCheckedChange={(v) => setRememberTin(v === true)}
                    />
                    Save this TIN to {selectedCustomer.name} for next time
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    None on file for {selectedCustomer.name}.
                  </p>
                )}
              </div>
            )}

            {/*
              Offered on every customer, not only those who already have
              branches — otherwise the first one could never be made from here,
              which is the only place anybody realises they need it.

              Head office is a real choice on the list rather than the absence
              of one, so an invoice is never blocked for want of a branch to put
              on it.
            */}
            {customerId && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="branch">
                  Branch <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Combobox
                  id="branch"
                  options={branchOptions}
                  value={branchId ?? ""}
                  onChange={(value) => setBranchId(value || null)}
                  placeholder="Head office"
                  searchPlaceholder="Search branches…"
                  emptyText="No branch by that name yet."
                  onCreate={(typed) => setNewBranchName(typed)}
                  createLabel="Create new branch"
                />
                <p className="text-xs text-muted-foreground">
                  {branchId
                    ? "Printed on the invoice, and grouped on their statement."
                    : "Leave as Head office if this is not for a particular branch."}
                </p>
              </div>
            )}

            {/*
              The line-item table used to live below this card. It asked you to
              fill a row before you could see what you were selling — a form
              pretending to be a catalogue. Choosing happens on its own screen
              now, and this is the way in.

              Disabled until there is a customer, because the price offered
              depends on who is buying: agreed prices are looked up per
              customer, so opening this first would show list prices and then
              silently change them.
            */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Button
                type="button"
                size="lg"
                variant={lines.length > 0 ? "outline" : "default"}
                disabled={!customerId}
                onClick={() => setPickerOpen(true)}
                className="w-full justify-center"
              >
                <ShoppingBag className="size-4" />
                Select Products
              </Button>

              {lines.length > 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  {chosenCount} {chosenCount === 1 ? "item" : "items"} ·{" "}
                  <span className="font-medium text-foreground">
                    {formatMoney(totals.total)}
                  </span>
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  {customerId
                    ? "Pick what you are selling — tap a product to add it."
                    : "Choose a customer first."}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order_date">Order date</Label>
              <DateInput
                id="order_date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                When they ordered. The invoice date is stamped when you issue it.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="terms">Payment terms</Label>
              <div className="flex flex-wrap gap-1.5">
                {TERM_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTermsDays(d)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      termsDays === d
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-accent",
                    )}
                  >
                    {d} days
                  </button>
                ))}
                <Input
                  id="terms"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  value={termsDays}
                  onChange={(e) => setTermsDays(Math.max(0, Number(e.target.value) || 0))}
                  className="h-8 w-20 text-xs"
                  aria-label="Custom payment terms in days"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Issued today → due {formatDate(dueIfIssuedToday)}
              </p>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <span className="text-sm">
                <span className="font-medium">Add VAT at {vatRate}%</span>
                <span className="block text-xs text-muted-foreground">
                  Charged on top of your prices — the customer pays it
                </span>
              </span>
              <Switch
                checked={vatMode === "exclusive"}
                onCheckedChange={(on) => setVatMode(on ? "exclusive" : "none")}
              />
            </label>

            {/*
              Left empty rather than showing 0, so an invoice with no discount
              has an empty box and a document with no mention of one. A zero
              sitting in the field reads as a value somebody chose.
            */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
              <Label htmlFor="discount" className="text-sm font-normal">
                <span className="font-medium">Discount</span>
                {/*
                  Says where the number came from when it was not typed. A
                  figure that appears by itself is only trustworthy if the
                  screen admits who put it there.
                */}
                <span className="block text-xs text-muted-foreground">
                  {discountPercent <= 0
                    ? "Leave empty for no discount"
                    : fromCustomerRecord
                      ? `${selectedCustomer?.name ?? "This customer"}'s usual discount — ${formatMoney(totals.discount)} off, before VAT`
                      : `Taken off before VAT — ${formatMoney(totals.discount)} off this invoice`}
                </span>
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="discount"
                  type="number"
                  min={0}
                  max={99.99}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0"
                  value={discountInput}
                  onChange={(e) =>
                    setDiscountEdit({ forCustomer: customerId, value: e.target.value })
                  }
                  className="h-8 w-20 text-right"
                  aria-label="Discount percentage"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer_notes">Note on the invoice</Label>
              <Textarea
                id="customer_notes"
                rows={3}
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="Delivery details, payment instructions…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="internal_notes">Private note</Label>
              <Textarea
                id="internal_notes"
                rows={3}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Only you and your team see this"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary rail: sticky beside the form on desktop, inline on phones. */}
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="max-w-[60%] truncate font-medium">
                {selectedCustomer?.name ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular font-medium">{formatMoney(totals.subtotal)}</dd>
            </div>
            {/* Only when there is one. See the note on the field above. */}
            {totals.discount > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Discount ({discountPercent}%)</dt>
                <dd className="tabular font-medium text-emerald-700 dark:text-emerald-400">
                  − {formatMoney(totals.discount)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                VAT {vatMode === "exclusive" ? `(${vatRate}%)` : "(not charged)"}
              </dt>
              <dd className="tabular font-medium">{formatMoney(totals.vat)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2.5">
              <dt className="font-medium">Total</dt>
              <dd className="tabular text-lg font-semibold">
                TSh {formatMoney(totals.total)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="button"
              onClick={onIssueNow}
              disabled={pending || !online}
              className="w-full"
            >
              {busy === "issue" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Issue invoice now
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSaveDraft}
              disabled={pending}
              className="w-full"
            >
              {busy === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save as draft
            </Button>
            <p className="text-xs text-muted-foreground">
              {online
                ? "Drafts get no invoice number. Issue it on the day you ship and the number, invoice date and due date are all stamped then."
                : "You are offline. Save it as a draft — it is kept on this device and uploaded automatically. Issuing needs a connection, because the invoice number comes from the server."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/*
        Mounted here rather than inside the pickers, because a picker lives in
        a popover and a dialog opened from inside one closes along with it.

        Keyed on the typed name so the form is rebuilt each time: without that,
        a second attempt would reopen still showing the last one's contents.
      */}
      {/* Mounted only while open, so each visit starts with a clear search
          without an effect having to reach in and reset one. */}
      {pickerOpen && (
      <ProductPicker
        onClose={() => setPickerOpen(false)}
        products={products}
        lines={lines}
        vatRate={vatRate}
        vatApplies={vatMode === "exclusive"}
        onAdd={addProduct}
        onUpdate={updateLine}
        onRemove={removeLine}
        onClear={() => setLines([])}
        onCreateProduct={(typed) => setNewProductName(typed)}
      />
      )}

      {newCustomerName !== null && (
        <CustomerDialog
          key={`customer-${newCustomerName}`}
          open
          initialName={newCustomerName}
          defaultTermsDays={defaultTermsDays}
          onOpenChange={(next) => {
            if (!next) setNewCustomerName(null);
          }}
          onSaved={(saved) => {
            setNewCustomerName(null);
            // Selected straight away. The point of adding them from here is to
            // carry on with the invoice, not to be handed an empty picker.
            setCustomerId(saved.id);
            // Their terms are taken from the row just saved rather than looked
            // up: the picker's list has not re-read the mirror yet.
            if (!invoice) setTermsDays(saved.payment_terms_days);
          }}
        />
      )}

      {/*
        The branch form, opened from the picker rather than from the customer
        screen — the same reasoning as the customer and product dialogs above.
        The name typed into the picker is carried in, because somebody who has
        typed "Mwanza" and found nothing has already answered the form's first
        question.
      */}
      {newBranchName !== null && customerId && (
        <BranchDialog
          key={`branch-${newBranchName}`}
          open
          customerId={customerId}
          initialName={newBranchName}
          askToKeep
          onOpenChange={(next) => {
            if (!next) setNewBranchName(null);
          }}
          onSaved={(saved) => {
            setNewBranchName(null);
            // Selected from the row just written rather than looked up: the
            // picker's list has not re-read the mirror yet.
            setBranchId(saved.id);
          }}
        />
      )}


      {newProductName !== null && (
        <ProductDialog
          key={`product-${newProductName}`}
          open
          initialName={newProductName}
          onOpenChange={(next) => {
            if (!next) setNewProductName(null);
          }}
          onSaved={(saved) => {
            setNewProductName(null);
            // Added from the row the dialog just wrote, not looked up: the
            // picker's list has not re-read the mirror yet.
            addProduct(saved);
          }}
        />
      )}
    </div>
  );
}
