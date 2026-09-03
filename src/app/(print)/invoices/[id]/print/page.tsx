import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { InvoiceDocument } from "@/components/invoice-document";
import { qrSvg } from "@/lib/qr";
import { publicInvoiceUrl } from "@/lib/site-url";
import { PrintControls } from "@/components/print-controls";
import type {
  Customer,
  CustomerBranch,
  Invoice,
  InvoiceBalance,
  InvoiceItem,
} from "@/lib/types";

export const metadata = { title: "Print invoice" };

export default async function PrintInvoicePage(
  props: PageProps<"/invoices/[id]/print">,
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

  const [{ data: customerRow }, { data: itemRows }, { data: balanceRow }, { data: branchRow }] =
    await Promise.all([
      supabase.from("customers").select("*").eq("id", invoice.customer_id).maybeSingle(),
      supabase
        .from("invoice_items_view")
        .select("*")
        .eq("invoice_id", id)
        .order("line_no"),
      supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
      // Only for its address and contact details; the branch NAME comes off
      // the invoice's own snapshot. A head-office invoice asks for nothing.
      invoice.branch_id
        ? supabase
            .from("customer_branches")
            .select("*")
            .eq("id", invoice.branch_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (!customerRow) notFound();

  const publicUrl =
    invoice.status === "draft" ? null : await publicInvoiceUrl(invoice.public_token);
  const qr = publicUrl ? await qrSvg(publicUrl, 96) : null;

  return (
    <>
      <PrintControls invoiceId={id} autoPrint={searchParams.auto === "1"} />

      <div className="mx-auto w-full max-w-[210mm] pb-10 print:pb-0">
        <div className="print-sheet bg-white shadow-lg">
          <InvoiceDocument
            org={session.org}
            customer={customerRow as Customer}
            invoice={invoice}
            items={(itemRows ?? []) as InvoiceItem[]}
            amountPaid={Number((balanceRow as InvoiceBalance | null)?.amount_paid ?? 0)}
            branch={branchRow as CustomerBranch | null}
            qr={
              qr ? (
                <div
                  className="size-24 [&>svg]:size-full"
                  // Built by lib/qr.ts from our own URL, never user input.
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : null
            }
            publicUrl={publicUrl}
          />
        </div>
      </div>
    </>
  );
}
