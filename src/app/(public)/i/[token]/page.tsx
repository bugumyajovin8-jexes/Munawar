import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTZS } from "@/lib/format";
import { round2 } from "@/lib/money";
import { qrSvg } from "@/lib/qr";
import { publicInvoiceUrl } from "@/lib/site-url";
import { InvoiceDocument } from "@/components/invoice-document";
import { PublicPrintButton } from "./print-button";
import type { Customer, CustomerBranch, Invoice, InvoiceItem, Org } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicPayload = {
  invoice: Invoice;
  customer: Customer;
  org: Org;
  items: InvoiceItem[];
  /** Null for a head-office invoice, and null on any link shared before 0014. */
  branch: CustomerBranch | null;
  amount_paid: number;
};

async function load(token: string): Promise<PublicPayload | null> {
  if (!UUID_RE.test(token)) return null;

  const supabase = await createClient();
  // SECURITY DEFINER function granted to anon — it assembles a payload with
  // no internal notes and no cost prices, so there is nothing here the
  // customer would not see on the printed invoice.
  const { data, error } = await supabase.rpc("public_invoice", { p_token: token });
  if (error || !data) return null;
  return data as PublicPayload;
}

export async function generateMetadata(
  props: PageProps<"/i/[token]">,
): Promise<Metadata> {
  const { token } = await props.params;
  const payload = await load(token);
  if (!payload) return { title: "Invoice not found" };

  return {
    title: `${payload.invoice.number} · ${payload.org.name}`,
    description: `Invoice ${payload.invoice.number} from ${payload.org.name}`,
    // A shared link should not end up in search results.
    robots: { index: false, follow: false },
  };
}

export default async function PublicInvoicePage(props: PageProps<"/i/[token]">) {
  const { token } = await props.params;
  const payload = await load(token);
  if (!payload) notFound();

  const { invoice, customer, org, items, branch } = payload;
  const amountPaid = Number(payload.amount_paid ?? 0);
  const balance = round2(Number(invoice.total) - amountPaid);

  const url = await publicInvoiceUrl(token);
  const qr = await qrSvg(url, 96);

  const isVoid = invoice.status === "void";
  const isPaid = balance <= 0;
  const isOverdue =
    !isPaid && !isVoid && invoice.due_date !== null && invoice.due_date < todayISO();

  return (
    <>
      <header className="border-b border-neutral-200 bg-white print:hidden">
        <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{org.name}</p>
            <p className="text-xs text-neutral-500">
              Invoice {invoice.number} · {formatDate(invoice.invoice_date)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-medium",
                isVoid
                  ? "bg-neutral-200 text-neutral-700"
                  : isPaid
                    ? "bg-green-100 text-green-800"
                    : isOverdue
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-900",
              ].join(" ")}
            >
              {isVoid
                ? "Cancelled"
                : isPaid
                  ? "Paid in full"
                  : `${formatTZS(balance)} due${invoice.due_date ? ` by ${formatDate(invoice.due_date)}` : ""}`}
            </span>
            <PublicPrintButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[210mm] px-0 py-4 sm:px-4 sm:py-6 print:p-0">
        <div className="print-sheet bg-white shadow-lg">
          <InvoiceDocument
            org={org}
            customer={customer}
            invoice={invoice}
            items={items}
            amountPaid={amountPaid}
            branch={branch ?? null}
            qr={
              qr ? (
                <div
                  className="size-24 [&>svg]:size-full"
                  // Built by lib/qr.ts from our own URL, never user input.
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : null
            }
            publicUrl={url}
          />
        </div>

        <p className="px-6 py-5 text-center text-xs text-neutral-500 print:hidden">
          Questions about this invoice? Contact {org.name}
          {org.phone ? ` on ${org.phone}` : ""}
          {org.email ? ` or ${org.email}` : ""}.
        </p>
      </main>
    </>
  );
}

/** Today in Dar es Salaam, for the overdue badge. */
function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
