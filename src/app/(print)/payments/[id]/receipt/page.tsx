import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { amountInWords } from "@/lib/words";
import { displayPhone } from "@/lib/phone";
import { round2 } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import { PrintControls } from "@/components/print-controls";

export const metadata = { title: "Payment receipt" };

type Row = {
  id: string;
  paid_on: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  created_at: string;
  invoice: {
    id: string;
    number: string | null;
    total: number;
    customer: {
      name: string;
      address: string | null;
      city: string | null;
      phone_e164: string | null;
      tin: string | null;
    } | null;
  } | null;
};

export default async function ReceiptPage(
  props: PageProps<"/payments/[id]/receipt">,
) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from("payments")
    .select(
      "id, paid_on, amount, method, reference, note, created_at, invoice:invoices(id, number, total, customer:customers(name, address, city, phone_e164, tin))",
    )
    .eq("id", id)
    .maybeSingle();

  const payment = data as unknown as Row | null;
  if (!payment?.invoice) notFound();

  const invoice = payment.invoice;
  const customer = invoice.customer;

  // Balance as at this payment: everything received on or before it.
  const { data: priorRows } = await supabase
    .from("payments")
    .select("amount, paid_on, created_at")
    .eq("invoice_id", invoice.id)
    .lte("created_at", payment.created_at);

  const paidToDate = (priorRows ?? []).reduce(
    (sum, p) => sum + Number(p.amount),
    0,
  );
  const balanceAfter = round2(Number(invoice.total) - paidToDate);
  const org = session.org;

  return (
    <>
      <PrintControls
        invoiceId={invoice.id}
        autoPrint={searchParams.auto === "1"}
      />

      <div className="mx-auto w-full max-w-[210mm] pb-10 print:pb-0">
        <div className="print-sheet bg-white shadow-lg">
          <div className="print-document mx-auto w-full max-w-[210mm] bg-white p-6 text-[13px] leading-normal text-neutral-900 sm:p-10">
            <header className="flex flex-col gap-6 border-b-2 border-neutral-900 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight">
                  {org.legal_name || org.name}
                </h1>
                <div className="mt-1.5 space-y-0.5 text-[12px] text-neutral-600">
                  {org.address && <p className="whitespace-pre-line">{org.address}</p>}
                  {org.phone && <p>{displayPhone(org.phone)}</p>}
                  {org.tin && (
                    <p className="pt-1 font-medium text-neutral-800">TIN: {org.tin}</p>
                  )}
                </div>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-lg font-bold tracking-wide">PAYMENT RECEIPT</p>
                <p className="mt-1 text-[15px] font-semibold tabular">
                  RCT-{payment.id.slice(0, 8).toUpperCase()}
                </p>
                <p className="mt-0.5 text-[12px] text-neutral-600">
                  {formatDate(payment.paid_on)}
                </p>
              </div>
            </header>

            <section className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Received from
              </p>
              <p className="mt-1 font-semibold">{customer?.name ?? "—"}</p>
              <div className="mt-0.5 space-y-0.5 text-[12px] text-neutral-600">
                {customer?.address && (
                  <p className="whitespace-pre-line">{customer.address}</p>
                )}
                {customer?.city && <p>{customer.city}</p>}
                {customer?.phone_e164 && <p>{displayPhone(customer.phone_e164)}</p>}
              </div>
            </section>

            <table className="mt-6 w-full border-collapse">
              <tbody>
                <tr className="border-y border-neutral-300 bg-neutral-50">
                  <td className="py-2.5 pl-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                    Against invoice
                  </td>
                  <td className="py-2.5 pr-1 text-right font-semibold tabular">
                    {invoice.number}
                  </td>
                </tr>
                <tr className="border-b border-neutral-200">
                  <td className="py-2 pl-1 text-neutral-600">Payment method</td>
                  <td className="py-2 pr-1 text-right">
                    {PAYMENT_METHOD_LABELS[payment.method]}
                  </td>
                </tr>
                {payment.reference && (
                  <tr className="border-b border-neutral-200">
                    <td className="py-2 pl-1 text-neutral-600">Reference</td>
                    <td className="py-2 pr-1 text-right tabular">{payment.reference}</td>
                  </tr>
                )}
                <tr className="border-b border-neutral-200">
                  <td className="py-2 pl-1 text-neutral-600">Invoice total</td>
                  <td className="py-2 pr-1 text-right tabular">
                    {formatMoney(invoice.total)}
                  </td>
                </tr>
                <tr className="border-y-2 border-neutral-900">
                  <td className="py-3 pl-1 text-[15px] font-bold">Amount received</td>
                  <td className="py-3 pr-1 text-right text-[17px] font-bold tabular">
                    TSh {formatMoney(payment.amount)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pl-1 font-semibold">
                    {balanceAfter > 0 ? "Balance still due" : "Balance"}
                  </td>
                  <td className="py-2 pr-1 text-right font-semibold tabular">
                    TSh {formatMoney(Math.max(0, balanceAfter))}
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="mt-4 border-y border-neutral-200 py-2.5 text-[12px]">
              <span className="text-neutral-500">Amount in words: </span>
              <span className="font-medium">{amountInWords(Number(payment.amount))}</span>
            </p>

            {payment.note && (
              <p className="mt-4 text-[12px] text-neutral-700">
                <span className="text-neutral-500">Note: </span>
                {payment.note}
              </p>
            )}

            {balanceAfter <= 0 && (
              <p className="mt-6 inline-block rounded border-2 border-green-700 px-4 py-1.5 text-[13px] font-bold uppercase tracking-wide text-green-700">
                Paid in full
              </p>
            )}

            <div className="mt-12 flex justify-between gap-8 text-[12px]">
              <div className="flex-1">
                <div className="border-t border-neutral-400 pt-1.5 text-neutral-600">
                  Received by, for {org.name}
                </div>
              </div>
              <div className="flex-1">
                <div className="border-t border-neutral-400 pt-1.5 text-neutral-600">
                  Date
                </div>
              </div>
            </div>

            <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-[11px] text-neutral-500">
              This receipt confirms payment against invoice {invoice.number}. Please
              retain it for your records.
            </footer>
          </div>
        </div>
      </div>
    </>
  );
}
