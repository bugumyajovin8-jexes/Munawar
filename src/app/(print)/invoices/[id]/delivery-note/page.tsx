import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { PrintControls } from "@/components/print-controls";
import type { Customer, Invoice, InvoiceItem } from "@/lib/types";

export const metadata = { title: "Delivery note" };

/**
 * Quantities only — no prices. This is what travels with the goods and gets
 * signed by whoever receives them; the money side stays on the invoice.
 */
export default async function DeliveryNotePage(
  props: PageProps<"/invoices/[id]/delivery-note">,
) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!invoiceRow) notFound();
  const invoice = invoiceRow as Invoice;

  const [{ data: customerRow }, { data: itemRows }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", invoice.customer_id).maybeSingle(),
    supabase
      .from("invoice_items_view")
      .select("*")
      .eq("invoice_id", id)
      .order("line_no"),
  ]);

  if (!customerRow) notFound();
  const customer = customerRow as Customer;
  const items = (itemRows ?? []) as InvoiceItem[];
  const org = session.org;

  return (
    <>
      <PrintControls invoiceId={id} autoPrint={searchParams.auto === "1"} />

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
                </div>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-lg font-bold tracking-wide">DELIVERY NOTE</p>
                <p className="mt-1 text-[15px] font-semibold tabular">
                  {invoice.number ?? invoice.draft_ref}
                </p>
              </div>
            </header>

            <section className="mt-5 flex flex-col gap-6 sm:flex-row sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Deliver to
                </p>
                <p className="mt-1 font-semibold">{customer.name}</p>
                <div className="mt-0.5 space-y-0.5 text-[12px] text-neutral-600">
                  {customer.contact_person && <p>Attn: {customer.contact_person}</p>}
                  {customer.address && (
                    <p className="whitespace-pre-line">{customer.address}</p>
                  )}
                  {customer.city && <p>{customer.city}</p>}
                  {customer.phone_e164 && <p>{displayPhone(customer.phone_e164)}</p>}
                </div>
              </div>

              <div className="shrink-0">
                <table className="text-[12px]">
                  <tbody>
                    <tr>
                      <td className="py-1 pr-6 text-neutral-600">Order date</td>
                      <td className="py-1 text-right tabular">
                        {formatDate(invoice.order_date)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-6 text-neutral-600">Delivery date</td>
                      <td className="py-1 text-right font-medium tabular">
                        {formatDate(invoice.ship_date ?? invoice.invoice_date)}
                      </td>
                    </tr>
                    {invoice.number && (
                      <tr>
                        <td className="py-1 pr-6 text-neutral-600">Invoice</td>
                        <td className="py-1 text-right tabular">{invoice.number}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <table className="mt-6 w-full border-collapse">
              <thead>
                <tr className="border-y border-neutral-300 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-600">
                  <th className="w-8 py-2 pl-1 text-left font-semibold">#</th>
                  <th className="py-2 text-left font-semibold">Description</th>
                  <th className="w-20 py-2 text-right font-semibold">Qty</th>
                  <th className="w-16 py-2 text-left font-semibold">Unit</th>
                  <th className="w-24 py-2 pr-1 text-center font-semibold">Received</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-neutral-200">
                    <td className="py-2.5 pl-1 align-top text-neutral-500 tabular">
                      {item.line_no}
                    </td>
                    <td className="py-2.5 pr-3 align-top">{item.description}</td>
                    <td className="py-2.5 text-right align-top tabular font-medium">
                      {formatQty(item.qty)}
                    </td>
                    <td className="py-2.5 align-top text-neutral-600">{item.unit}</td>
                    <td className="py-2.5 pr-1">
                      <span className="mx-auto block h-5 w-16 border-b border-neutral-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-[11px] text-neutral-500">
              Prices are deliberately omitted. Please check the goods against this
              note before signing.
            </p>

            {invoice.customer_notes && (
              <div className="mt-5 text-[12px]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-line text-neutral-700">
                  {invoice.customer_notes}
                </p>
              </div>
            )}

            <div className="mt-14 flex flex-col gap-10 text-[12px] sm:flex-row sm:gap-8">
              <div className="flex-1">
                <div className="border-t border-neutral-400 pt-1.5 text-neutral-600">
                  Delivered by (name &amp; signature)
                </div>
              </div>
              <div className="flex-1">
                <div className="border-t border-neutral-400 pt-1.5 text-neutral-600">
                  Received by (name &amp; signature)
                </div>
              </div>
              <div className="w-32">
                <div className="border-t border-neutral-400 pt-1.5 text-neutral-600">
                  Date
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
