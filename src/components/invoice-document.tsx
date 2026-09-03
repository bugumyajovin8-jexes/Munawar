import { formatDate, formatMoney } from "@/lib/format";
import { amountInWords } from "@/lib/words";
import { displayPhone } from "@/lib/phone";
import type { Customer, CustomerBranch, Invoice, InvoiceItem, Org } from "@/lib/types";

/**
 * The document itself — the thing the customer actually sees. Rendered both in
 * the app (as a preview) and on the print page, so what you check on screen is
 * exactly what comes out of the printer.
 */
export function InvoiceDocument({
  org,
  customer,
  invoice,
  items,
  amountPaid = 0,
  branch = null,
  qr = null,
  publicUrl = null,
}: {
  org: Org;
  customer: Customer;
  invoice: Invoice;
  items: InvoiceItem[];
  amountPaid?: number;
  /**
   * The branch record, where this invoice was for one.
   *
   * Only its address and contact details are read from here — the name comes
   * off the invoice's own snapshot, because that is what the document said on
   * the day. The address is live for the same reason the customer's own
   * address already is: it is where to deliver and who to ring, and the useful
   * version of that is the current one. Optional, so a caller with nothing to
   * pass simply falls back to the customer's details, field by field.
   */
  branch?: CustomerBranch | null;
  /**
   * The QR square, already rendered.
   *
   * A node rather than markup, because the two callers now produce it
   * differently: the print and public routes stay on the server and pass the
   * SVG from lib/qr.ts, while the app's own invoice screen renders it on the
   * device — that screen no longer talks to the server at all, and a picture
   * of a URL it already knows was not worth keeping it there for.
   */
  qr?: React.ReactNode;
  publicUrl?: string | null;
}) {
  /*
   * Ordered here rather than trusted from the caller.
   *
   * The print and public routes ask Postgres for `order by line_no`; the app's
   * own screen reads the device, where an index scan hands rows back in key
   * order — which is uuid order, and therefore no order at all. The same
   * invoice listed its products 3, 2, 1 on screen and 1, 2, 3 on paper. Sorting
   * in the one component that draws all three removes the possibility of them
   * disagreeing again.
   */
  const rows = [...items].sort((a, b) => Number(a.line_no) - Number(b.line_no));

  const balance = Number(invoice.total) - Number(amountPaid);

  // Field by field, not all-or-nothing: a branch with a contact person but no
  // address of its own should show that person and the customer's address.
  const branchContact = branch?.contact_person ?? customer.contact_person;
  const branchAddress = branch?.address ?? customer.address;
  const branchCity = branch?.city ?? customer.city;
  const branchPhone = branch?.phone_e164 ?? customer.phone_e164;
  const isVat = invoice.vat_mode === "exclusive" && Number(invoice.vat_amount) > 0;
  const title =
    invoice.doc_type === "credit_note"
      ? "CREDIT NOTE"
      : invoice.status === "draft"
        ? "PROFORMA INVOICE"
        : isVat
          ? "TAX INVOICE"
          : "INVOICE";

  return (
    <div className="print-document mx-auto w-full max-w-[210mm] bg-white p-6 text-[13px] leading-normal text-neutral-900 sm:p-10">
      {/* Letterhead */}
      <header className="flex flex-col gap-6 border-b-2 border-neutral-900 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">
            {org.legal_name || org.name}
          </h1>
          <div className="mt-1.5 space-y-0.5 text-[12px] text-neutral-600">
            {org.address && <p className="whitespace-pre-line">{org.address}</p>}
            {org.city && <p>{org.city}, {org.country}</p>}
            {org.phone && <p>{displayPhone(org.phone)}</p>}
            {org.email && <p>{org.email}</p>}
            <p className="pt-1 font-medium text-neutral-800">
              {org.tin && <span>TIN: {org.tin}</span>}
              {org.tin && org.vrn && <span className="px-2">·</span>}
              {org.vrn && <span>VRN: {org.vrn}</span>}
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:text-right">
          <p className="text-lg font-bold tracking-wide">{title}</p>
          <p className="mt-1 text-[15px] font-semibold tabular">
            {invoice.number ?? invoice.draft_ref}
          </p>
          {invoice.status === "void" && (
            <p className="mt-1 font-bold text-red-600">VOIDED</p>
          )}
        </div>
      </header>

      {/* Parties and dates */}
      <section className="mt-5 flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Bill to
          </p>
          <p className="mt-1 font-semibold">{customer.name}</p>
          {/*
            The branch as the document recorded it, not as the customer record
            reads today — renaming a branch next year must not rewrite what
            this said when it was issued. Absent entirely for a head-office
            invoice, so a business with no branches never sees the word.
          */}
          {invoice.branch_name && (
            <p className="text-[13px] font-medium text-neutral-700">
              {invoice.branch_name} branch
            </p>
          )}
          <div className="mt-0.5 space-y-0.5 text-[12px] text-neutral-600">
            {branchContact && <p>Attn: {branchContact}</p>}
            {branchAddress && <p className="whitespace-pre-line">{branchAddress}</p>}
            {branchCity && <p>{branchCity}</p>}
            {branchPhone && <p>{displayPhone(branchPhone)}</p>}
            {/*
              The invoice's own snapshot wins over the customer's record.
              A TIN corrected next year must not rewrite what this document
              said on the day it was issued.
            */}
            {(invoice.customer_tin ?? customer.tin) && (
              <p>TIN: {invoice.customer_tin ?? customer.tin}</p>
            )}
            {customer.vrn && <p>VRN: {customer.vrn}</p>}
          </div>
        </div>

        <div className="shrink-0">
          <table className="text-[12px]">
            <tbody>
              <Row label="Order date" value={formatDate(invoice.order_date)} />
              <Row
                label="Invoice date"
                value={invoice.invoice_date ? formatDate(invoice.invoice_date) : "—"}
                bold
              />
              {invoice.ship_date && (
                <Row label="Shipped" value={formatDate(invoice.ship_date)} />
              )}
              <Row
                label={`Due date (${invoice.terms_days} days)`}
                value={invoice.due_date ? formatDate(invoice.due_date) : "—"}
                bold
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Lines */}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-300 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-600">
            <th className="w-8 py-2 pl-1 text-left font-semibold">#</th>
            <th className="py-2 text-left font-semibold">Description</th>
            <th className="w-16 py-2 text-right font-semibold">Qty</th>
            <th className="w-14 py-2 text-left font-semibold">Unit</th>
            <th className="w-28 py-2 text-right font-semibold">Price</th>
            <th className="w-28 py-2 pr-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200">
              <td className="py-2 pl-1 align-top text-neutral-500 tabular">
                {item.line_no}
              </td>
              <td className="py-2 pr-3 align-top">{item.description}</td>
              <td className="py-2 text-right align-top tabular">
                {formatMoney(item.qty)}
              </td>
              <td className="py-2 align-top text-neutral-600">{item.unit}</td>
              <td className="py-2 text-right align-top tabular">
                {formatMoney(item.unit_price)}
              </td>
              <td className="py-2 pr-1 text-right align-top tabular">
                {formatMoney(item.line_subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-4 flex justify-end">
        <table className="w-full max-w-[300px]">
          <tbody>
            <Row label="Subtotal" value={formatMoney(invoice.subtotal)} money />
            {/*
              Absent entirely when there is no discount — not a zero row.
              A document that says "Discount 0" invites the question of why it
              is there, on every invoice that never had one.
            */}
            {Number(invoice.discount_amount) > 0 && (
              <Row
                label={`Discount ${Number(invoice.discount_percent)}%`}
                value={`- ${formatMoney(invoice.discount_amount)}`}
                money
              />
            )}
            <Row
              label={
                invoice.vat_mode === "exclusive"
                  ? `VAT @ ${Number(invoice.vat_rate)}%`
                  : "VAT (not charged)"
              }
              value={formatMoney(invoice.vat_amount)}
              money
            />
            <tr className="border-t-2 border-neutral-900">
              <td className="py-2 text-[13px] font-bold">Total</td>
              <td className="py-2 text-right text-[15px] font-bold tabular">
                TSh {formatMoney(invoice.total)}
              </td>
            </tr>
            {amountPaid > 0 && (
              <>
                <Row label="Paid" value={`- ${formatMoney(amountPaid)}`} money />
                <tr className="border-t border-neutral-400">
                  <td className="py-1.5 font-bold">Balance due</td>
                  <td className="py-1.5 text-right font-bold tabular">
                    TSh {formatMoney(balance)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      <p className="mt-4 border-y border-neutral-200 py-2.5 text-[12px]">
        <span className="text-neutral-500">Amount in words: </span>
        <span className="font-medium">{amountInWords(Number(invoice.total))}</span>
      </p>

      {/* Footer blocks */}
      <section className="mt-5 flex flex-col gap-5 text-[12px] sm:flex-row sm:justify-between">
        <div className="grid flex-1 gap-5 sm:grid-cols-2">
          {invoice.customer_notes && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-line text-neutral-700">
                {invoice.customer_notes}
              </p>
            </div>
          )}
          {org.bank_details && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Payment details
              </p>
              <p className="mt-1 whitespace-pre-line text-neutral-700">
                {org.bank_details}
              </p>
            </div>
          )}
        </div>

        {qr && publicUrl && (
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {qr}
            <p className="max-w-28 text-center text-[10px] leading-tight text-neutral-500">
              Scan to view this invoice and its payment status online
            </p>
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-[11px] text-neutral-500">
        {org.invoice_footer ? (
          <p className="whitespace-pre-line">{org.invoice_footer}</p>
        ) : (
          <p>
            Please quote invoice number{" "}
            <strong className="text-neutral-700">
              {invoice.number ?? invoice.draft_ref}
            </strong>{" "}
            with your payment.
          </p>
        )}
      </footer>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  money,
}: {
  label: string;
  value: string;
  bold?: boolean;
  money?: boolean;
}) {
  return (
    <tr>
      <td
        className={`py-1 pr-6 text-neutral-600 ${money ? "text-[12px]" : ""}`}
      >
        {label}
      </td>
      <td
        className={`py-1 text-right tabular ${bold || money ? "font-medium" : ""} text-neutral-900`}
      >
        {value}
      </td>
    </tr>
  );
}
