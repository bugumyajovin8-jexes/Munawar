"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileX,
  Printer,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { InvoiceDocument } from "@/components/invoice-document";
import { InvoiceQr } from "@/components/invoice-qr";
import { LiveBalance } from "@/components/live-balance";
import { PaymentDialog } from "@/components/payment-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { sync } from "@/lib/offline/sync";
import { useAll, useAppSession, useOne, useRelated, useSync } from "@/lib/offline/local";
import { daysLate, round2 } from "@/lib/offline/derive";
import { ReminderButton } from "@/app/(app)/reminders/reminder-dialog";
import { DraftActions, PrintButton } from "./invoice-actions";
import { InvoiceMoreMenu } from "./invoice-menu";
import { ShareInvoice } from "./share-invoice";
import type {
  Customer,
  CustomerBranch,
  Invoice,
  InvoiceItem,
  Payment,
} from "@/lib/types";

/**
 * The origin, without reaching for `window` during the server render.
 *
 * useSyncExternalStore takes an explicit server snapshot, which is exactly the
 * shape of this question. The alternative — setting state in an effect — is
 * the pattern React 19 warns about, and it would flash an empty share link.
 */
const NEVER_CHANGES = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => window.location.origin,
    () => "",
  );
}

/**
 * The gap between an invoice existing and this device having a copy.
 *
 * Issuing writes the invoice on the server and comes straight here, so for a
 * moment the mirror genuinely does not have it. That moment needs its own
 * words. It used to fall through to "That invoice is not on this device — it
 * may have been deleted", which is the opposite of what has happened: the
 * document was created seconds ago, and the person reading that has every
 * reason to think their invoice is gone.
 */
function Arriving({ justIssued }: { justIssued: boolean }) {
  return (
    <Card className="flex flex-col gap-3 p-5" aria-busy="true" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        {justIssued
          ? "Saving the invoice to this device…"
          : "Looking for this invoice…"}
      </p>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
    </Card>
  );
}

/**
 * One invoice, assembled on this device.
 *
 * This was the last screen in daily use still rendering on the server, and it
 * was the expensive one: five Supabase queries and an auth check on every
 * open, and about thirty of them fetched again by the offline warm run after
 * every fresh sign-in. Together with the burst that produced, it was enough to
 * time Vercel's middleware out and put a 504 in front of somebody who had just
 * typed their password.
 *
 * Everything it needs was already mirrored — the invoice, its lines, its
 * payments, the customer — and the arithmetic already lives in derive.ts. Two
 * things were genuinely only on the server, and both moved rather than being
 * given up: the letterhead now travels with the session, and the QR is drawn
 * here from a URL the device already holds.
 */
export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const justIssued = searchParams.get("issued") === "1";

  const session = useAppSession();
  const syncState = useSync();
  const origin = useOrigin();
  const today = todayLocal();

  const invoice = useOne<Invoice>("invoices", id);
  const mirroredItems = useRelated<InvoiceItem>("invoiceItems", "invoice_id", id);

  /*
   * Lines this device guessed at are dropped once the server's own have
   * arrived, and this is the second place that happens.
   *
   * The mirror is cleaned on the next pull (see dropSupersededLines in
   * offline/sync.ts), but a device that already holds both sets must not go on
   * showing every product twice — and reporting double the margin — until that
   * pull comes round. When the only rows here are this device's, they are the
   * only copy there is and are shown as they are.
   */
  const items = useMemo(() => {
    const confirmed = mirroredItems.filter((i) => !(i as { _pending?: boolean })._pending);
    return confirmed.length > 0 ? confirmed : mirroredItems;
  }, [mirroredItems]);
  const payments = useRelated<Payment>("payments", "invoice_id", id);
  const customer = useOne<Customer>("customers", invoice?.customer_id ?? null);
  // Null for a head-office invoice, and null is what the document expects.
  const branch = useOne<CustomerBranch>("customerBranches", invoice?.branch_id ?? null);
  const allInvoices = useAll<Invoice>("invoices");

  const view = useMemo(() => {
    if (!invoice) return null;

    const total = Number(invoice.total);
    const amountPaid = round2(
      payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
    );
    const balance = round2(total - amountPaid);
    const late = balance > 0 ? daysLate(invoice.due_date, today) : 0;

    return {
      total,
      amountPaid,
      balance,
      isOverdue: late > 0,
      daysOverdue: late,
      // Credit notes raised against this invoice, oldest first.
      creditNotes: allInvoices
        .filter((i) => i.parent_invoice_id === invoice.id && i.status === "issued")
        .sort((a, b) =>
          String(a.invoice_date ?? "").localeCompare(String(b.invoice_date ?? "")),
        ),
      /*
       * Margin is admin-only, and only shown when every line carries one.
       * `!= null` on purpose: the view returns null for a sales role, and a
       * line this device wrote but has not yet sent has no such column at all.
       */
      /*
       * Line margins, less the discount given on the invoice as a whole.
       * line_profit is a line's margin at the price printed on that line, and
       * a whole-invoice discount appears on no line — so without subtracting
       * it here a discounted sale would report the margin that would have been
       * made had it not been discounted.
       */
      profit: round2(
        items.reduce((sum, i) => sum + Number(i.line_profit ?? 0), 0) -
          Number(invoice.discount_amount ?? 0),
      ),
      hasAllCosts: items.length > 0 && items.every((i) => i.line_profit != null),
    };
  }, [invoice, items, payments, allInvoices, today]);

  /*
   * What lastSyncedAt was when this screen opened.
   *
   * Absence only means something once we have actually looked. An invoice
   * exists on the server before it exists here, so arriving on a brand new one
   * and finding nothing in the mirror is the first normal moment of its life,
   * not evidence that anything is wrong. Until a pull has finished since this
   * screen opened, "not here" only ever means "not yet".
   */
  const [openedAt] = useState(syncState.lastSyncedAt);
  const looked = syncState.lastSyncedAt !== openedAt;

  /*
   * Ask for one, rather than waiting for the next scheduled pull. Issuing
   * triggers this too, but a link opened from a message or another device
   * arrives here with nothing having been asked for at all.
   */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (invoice || asked.current === id) return;
    asked.current = id;
    void sync();
  }, [invoice, id]);

  // Nothing on this device yet, and the mirror has never been filled.
  if (!invoice && isColdEmpty(allInvoices.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  if (!invoice) {
    // Refreshed since arriving and still not here, so it really is gone.
    if (looked) {
      return (
        <EmptyState
          icon={<FileX className="size-5" />}
          title="That invoice is not on this device"
          description="It may have been deleted, or it belongs to another business. Check the list."
          action={
            <Button asChild variant="outline">
              <Link href="/invoices">Back to invoices</Link>
            </Button>
          }
        />
      );
    }
    return <Arriving justIssued={justIssued} />;
  }

  // The invoice is here but something it refers to is not yet.
  if (!customer || !session || !view) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const isDraft = invoice.status === "draft";
  const isIssued = invoice.status === "issued";
  const isCreditNote = invoice.doc_type === "credit_note";
  const label = invoice.number ?? invoice.draft_ref;

  // Drafts have no number, so nothing to share yet.
  const publicUrl =
    !isDraft && origin ? `${origin}/i/${invoice.public_token}` : null;

  return (
    <>
      <Link
        href="/invoices"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        Invoices
      </Link>

      <PageHeader
        className="print:hidden"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular">{label}</span>
            <InvoiceStatusBadge
              status={invoice.status}
              paymentState={
                view.balance <= 0 ? "paid" : view.amountPaid > 0 ? "partial" : "unpaid"
              }
              isOverdue={view.isOverdue}
              daysOverdue={view.daysOverdue}
            />
          </span>
        }
        description={
          <Link
            href={`/customers/${customer.id}`}
            className="hover:text-foreground hover:underline"
          >
            {customer.name}
          </Link>
        }
        /*
          What stays in the open is what somebody does on an ordinary day:
          take a payment, chase it, print it. Everything else — duplicate,
          credit note, delivery note, void, delete — is occasional or
          destructive, and lives behind the menu. See InvoiceMoreMenu.
        */
        actions={
          <>
            {isDraft && <DraftActions invoice={invoice} />}

            {(isIssued || invoice.status === "void") && (
              <PrintButton invoiceId={invoice.id} />
            )}

            {isIssued && (
              <>
                {publicUrl && (
                  <ShareInvoice
                    url={publicUrl}
                    invoiceNumber={label}
                    customerName={customer.name}
                    customerPhone={customer.phone_e164}
                    orgName={session.org.name}
                    language={session.org.reminder_language}
                    total={view.total}
                    dueDate={invoice.due_date}
                  />
                )}

                {view.balance > 0 && (
                  <ReminderButton
                    kind={view.isOverdue ? "overdue" : "due_soon"}
                    customerName={customer.name}
                    customerPhone={customer.phone_e164}
                    orgName={session.org.name}
                    language={session.org.reminder_language}
                    invoices={[
                      {
                        number: label,
                        balance: view.balance,
                        dueDate: invoice.due_date,
                        daysOverdue: view.daysOverdue,
                      },
                    ]}
                    invoiceIds={[invoice.id]}
                    label={view.isOverdue ? "Send reminder" : "Send on WhatsApp"}
                    variant="outline"
                    size="default"
                  />
                )}

                {view.balance > 0 && (
                  <PaymentDialog
                    invoiceId={invoice.id}
                    invoiceNumber={label}
                    total={view.total}
                    amountPaid={view.amountPaid}
                    balance={view.balance}
                  />
                )}
              </>
            )}

            <InvoiceMoreMenu
              invoice={invoice}
              items={items}
              label={label}
              isAdmin={session.role === "admin"}
              isCreditNote={isCreditNote}
              /* Void is refused once money or a credit note is attached. */
              canVoid={payments.length === 0 && view.creditNotes.length === 0}
            />
          </>
        }
      />

      {justIssued && (
        <Card className="mb-5 border-success/40 bg-success/8 print:hidden">
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              <div className="text-sm">
                <p className="font-medium">Invoice {invoice.number} issued</p>
                <p className="text-muted-foreground">
                  Dated {formatDate(invoice.invoice_date)}, due{" "}
                  {formatDate(invoice.due_date)}. Print it now or come back to it
                  any time.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href={`/invoices/${invoice.id}/print?auto=1`} target="_blank">
                <Printer className="size-4" />
                Print now
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isIssued && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3 print:hidden">
          {/* Counted on this device, so a payment taken with no signal shows
              here immediately instead of after the next sync. */}
          <LiveBalance
            invoiceId={invoice.id}
            total={view.total}
            serverPaid={view.amountPaid}
            isOverdue={view.isOverdue}
            daysOverdue={view.daysOverdue}
            dueDate={invoice.due_date}
            mirrorReady={!syncState.cold}
          />
        </div>
      )}

      {session.role === "admin" && view.hasAllCosts && (
        <Card className="mb-5 print:hidden">
          <CardContent className="flex items-center justify-between pt-5 text-sm">
            <span className="text-muted-foreground">
              Gross profit on this invoice
              <span className="ml-1.5 text-xs">(admin only)</span>
            </span>
            <span
              className={`tabular font-semibold ${view.profit < 0 ? "text-destructive" : "text-success"}`}
            >
              {formatTZS(view.profit)}
            </span>
          </CardContent>
        </Card>
      )}

      {/* The document itself, exactly as it prints. */}
      <Card className="overflow-hidden border-border p-0 print:border-0 print:shadow-none">
        <div className="overflow-x-auto">
          <InvoiceDocument
            org={session.org}
            customer={customer}
            invoice={invoice}
            items={items}
            amountPaid={view.amountPaid}
            branch={branch}
            qr={publicUrl ? <InvoiceQr url={publicUrl} /> : null}
            publicUrl={publicUrl}
          />
        </div>
      </Card>

      {isIssued && (
        <Card className="mt-5 print:hidden">
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <Wallet className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No payments recorded against {label} yet.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="hidden sm:table-cell">Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-24 text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...payments]
                    .sort((a, b) =>
                      String(a.paid_on).localeCompare(String(b.paid_on)),
                    )
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(p.paid_on)}
                        </TableCell>
                        <TableCell>
                          {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {p.reference ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular font-medium text-success">
                          {formatMoney(p.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              href={`/payments/${p.id}/receipt?auto=1`}
                              target="_blank"
                            >
                              <Receipt className="size-4" />
                              <span className="sr-only sm:not-sr-only">Print</span>
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {view.creditNotes.length > 0 && (
        <Card className="mt-5 print:hidden">
          <CardHeader>
            <CardTitle>Credit notes against this invoice</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.creditNotes.map((cn) => (
                  <TableRow key={cn.id}>
                    <TableCell>
                      <Link
                        href={`/invoices/${cn.id}`}
                        className="font-medium tabular hover:text-primary hover:underline"
                      >
                        {cn.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(cn.invoice_date)}
                    </TableCell>
                    <TableCell className="text-right tabular font-medium text-destructive">
                      {formatMoney(cn.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isCreditNote && invoice.parent_invoice_id && (
        <Card className="mt-5 print:hidden">
          <CardContent className="pt-5 text-sm">
            <p className="text-muted-foreground">
              This credit note was raised against{" "}
              <Link
                href={`/invoices/${invoice.parent_invoice_id}`}
                className="font-medium text-foreground hover:text-primary hover:underline"
              >
                the original invoice
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {invoice.status === "void" && invoice.void_reason && (
        <Card className="mt-5 border-destructive/30 bg-destructive/5 print:hidden">
          <CardContent className="pt-5 text-sm">
            <p className="font-medium text-destructive">Voided</p>
            <p className="mt-0.5 text-muted-foreground">{invoice.void_reason}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
