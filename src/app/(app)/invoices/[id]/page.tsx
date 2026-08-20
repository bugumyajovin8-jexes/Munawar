import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Printer, Receipt, Truck, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate, formatMoney, formatTZS } from "@/lib/format";
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
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { InvoiceDocument } from "@/components/invoice-document";
import { LiveBalance } from "@/components/live-balance";
import { DraftActions, PrintButton, VoidButton } from "./invoice-actions";
import { PaymentDialog } from "@/components/payment-dialog";
import { CreditNoteDialog, DuplicateButton } from "./document-actions";
import { ShareInvoice } from "./share-invoice";
import { ReminderButton } from "@/app/(app)/reminders/reminder-dialog";
import { qrSvg } from "@/lib/qr";
import { publicInvoiceUrl } from "@/lib/site-url";
import type {
  Customer,
  Invoice,
  InvoiceBalance,
  InvoiceItem,
  Payment,
} from "@/lib/types";

export default async function InvoiceDetailPage(props: PageProps<"/invoices/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const justIssued = searchParams.issued === "1";

  const session = await requireSession();
  const supabase = await createClient();

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!invoiceRow) notFound();
  const invoice = invoiceRow as Invoice;

  const [
    { data: customerRow },
    { data: itemRows },
    { data: balanceRow },
    { data: paymentRows },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", invoice.customer_id).maybeSingle(),
    supabase
      .from("invoice_items_view")
      .select("*")
      .eq("invoice_id", id)
      .order("line_no"),
    supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("payments").select("*").eq("invoice_id", id).order("paid_on"),
  ]);

  if (!customerRow) notFound();
  const customer = customerRow as Customer;
  const items = (itemRows ?? []) as InvoiceItem[];
  const balance = balanceRow as InvoiceBalance | null;
  const payments = (paymentRows ?? []) as Payment[];

  const isDraft = invoice.status === "draft";
  const isIssued = invoice.status === "issued";
  const isCreditNote = invoice.doc_type === "credit_note";
  const label = invoice.number ?? invoice.draft_ref;

  // Drafts have no number, so nothing to share yet.
  const publicUrl = isDraft ? null : await publicInvoiceUrl(invoice.public_token);
  const qr = publicUrl ? await qrSvg(publicUrl, 96) : null;

  // Credit notes already raised against this invoice.
  const { data: creditNoteRows } = isIssued && !isCreditNote
    ? await supabase
        .from("invoices")
        .select("id, number, invoice_date, total")
        .eq("parent_invoice_id", id)
        .eq("status", "issued")
        .order("invoice_date")
    : { data: [] };
  const creditNotes = creditNoteRows ?? [];

  // Margin is admin-only; invoice_items_view already returns null for sales.
  const totalProfit = items.reduce((sum, i) => sum + Number(i.line_profit ?? 0), 0);
  const showProfit = session.role === "admin" && items.every((i) => i.line_profit !== null);

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
              paymentState={balance?.payment_state}
              isOverdue={balance?.is_overdue}
              daysOverdue={balance?.days_overdue}
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
        actions={
          <>
            {isDraft && <DraftActions invoice={invoice} />}
            {isIssued && (
              <>
                <PrintButton invoiceId={invoice.id} />
                {!isCreditNote && (
                  <Button variant="outline" asChild>
                    <Link
                      href={`/invoices/${invoice.id}/delivery-note`}
                      target="_blank"
                    >
                      <Truck className="size-4" />
                      Delivery note
                    </Link>
                  </Button>
                )}
                {publicUrl && (
                  <ShareInvoice
                    url={publicUrl}
                    invoiceNumber={label}
                    customerName={customer.name}
                    customerPhone={customer.phone_e164}
                    orgName={session.org.name}
                    language={session.org.reminder_language}
                    total={Number(invoice.total)}
                    dueDate={invoice.due_date}
                  />
                )}
                {(balance?.balance ?? 0) > 0 && (
                  <ReminderButton
                    kind={balance?.is_overdue ? "overdue" : "due_soon"}
                    customerName={customer.name}
                    customerPhone={customer.phone_e164}
                    orgName={session.org.name}
                    language={session.org.reminder_language}
                    invoices={[
                      {
                        number: label,
                        balance: Number(balance?.balance ?? invoice.total),
                        dueDate: invoice.due_date,
                        daysOverdue: balance?.days_overdue ?? 0,
                      },
                    ]}
                    invoiceIds={[invoice.id]}
                    label={balance?.is_overdue ? "Send reminder" : "Send on WhatsApp"}
                    variant="outline"
                    size="default"
                  />
                )}
                {(balance?.balance ?? 0) > 0 && (
                  <PaymentDialog
                    invoiceId={invoice.id}
                    invoiceNumber={label}
                    total={Number(invoice.total)}
                    amountPaid={Number(balance?.amount_paid ?? 0)}
                    balance={Number(balance?.balance ?? invoice.total)}
                  />
                )}
                {!isCreditNote && <DuplicateButton invoiceId={invoice.id} />}
                {session.role === "admin" && !isCreditNote && items.length > 0 && (
                  <CreditNoteDialog
                    invoiceId={invoice.id}
                    invoiceNumber={label}
                    items={items}
                  />
                )}
                {session.role === "admin" &&
                  payments.length === 0 &&
                  creditNotes.length === 0 && <VoidButton invoice={invoice} />}
              </>
            )}
            {invoice.status === "void" && <PrintButton invoiceId={invoice.id} />}
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
              <Link href={`/invoices/${invoice.id}/print`} target="_blank">
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
            total={Number(invoice.total)}
            serverPaid={Number(balance?.amount_paid ?? 0)}
            isOverdue={Boolean(balance?.is_overdue)}
            daysOverdue={balance?.days_overdue ?? 0}
            dueDate={invoice.due_date}
            mirrorReady
          />
        </div>
      )}

      {showProfit && (
        <Card className="mb-5 print:hidden">
          <CardContent className="flex items-center justify-between pt-5 text-sm">
            <span className="text-muted-foreground">
              Gross profit on this invoice
              <span className="ml-1.5 text-xs">(admin only)</span>
            </span>
            <span
              className={`tabular font-semibold ${totalProfit < 0 ? "text-destructive" : "text-success"}`}
            >
              {formatTZS(totalProfit)}
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
            amountPaid={Number(balance?.amount_paid ?? 0)}
            qr={qr}
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
                  {payments.map((p) => (
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
                          <Link href={`/payments/${p.id}/receipt`} target="_blank">
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

      {creditNotes.length > 0 && (
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
                {creditNotes.map((cn) => (
                  <TableRow key={cn.id as string}>
                    <TableCell>
                      <Link
                        href={`/invoices/${cn.id}`}
                        className="font-medium tabular hover:text-primary hover:underline"
                      >
                        {cn.number as string}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(cn.invoice_date as string)}
                    </TableCell>
                    <TableCell className="text-right tabular font-medium text-destructive">
                      {formatMoney(cn.total as number)}
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
