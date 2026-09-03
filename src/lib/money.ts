/**
 * Money helpers.
 *
 * The database is the authority on every stored amount: line totals are
 * generated columns and invoice totals come from recalc_invoice_totals().
 * What lives here is the *live preview* in the invoice builder, which has to
 * agree with the database to the shilling — so it rounds the same way the SQL
 * does: per line, then sum. Rounding once at the end is what produces the
 * off-by-one-shilling arguments with customers.
 */

/** Round to 2dp without the usual binary-float surprises (1.005 -> 1.01). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const scaled = Math.round(Number(`${n}e2`));
  return Number(`${scaled}e-2`);
}

/** Coerce anything the DB or a form hands us into a usable number. */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const parsed = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function lineSubtotal(qty: number, unitPrice: number): number {
  return round2(num(qty) * num(unitPrice));
}

export function lineVat(
  qty: number,
  unitPrice: number,
  vatApplicable: boolean,
  vatRate: number,
): number {
  if (!vatApplicable) return 0;
  return round2((lineSubtotal(qty, unitPrice) * num(vatRate)) / 100);
}

export function lineTotal(
  qty: number,
  unitPrice: number,
  vatApplicable: boolean,
  vatRate: number,
): number {
  return round2(
    lineSubtotal(qty, unitPrice) + lineVat(qty, unitPrice, vatApplicable, vatRate),
  );
}

export type PreviewLine = {
  qty: number;
  unit_price: number;
  vat_applicable: boolean;
};

/**
 * One line's share of a whole-invoice discount.
 *
 * Rounded here, at the line, because that is where recalc_invoice_totals()
 * rounds it. Working the discount out once on the invoice subtotal instead is
 * off by a shilling or two often enough to matter, and it is always noticed on
 * the invoice you would rather it were not.
 */
export function lineDiscount(
  qty: number,
  unitPrice: number,
  discountPercent: number,
): number {
  if (!discountPercent) return 0;
  return round2((lineSubtotal(qty, unitPrice) * num(discountPercent)) / 100);
}

export type Totals = {
  subtotal: number;
  /** Zero when no discount was given, which is how every screen knows to say nothing. */
  discount: number;
  vat: number;
  total: number;
};

/**
 * Mirrors the SQL exactly: round each line, then add the rounded lines up.
 * `vatMode === "none"` zeroes VAT regardless of the per-line flag, matching
 * save_draft_invoice().
 *
 * The discount comes off before VAT, because VAT is charged on what is
 * actually payable — 18% of the discounted line, never of the list price.
 * Subtotal stays the undiscounted figure: the document shows what the goods
 * come to, then what was taken off, and the two have to reconcile.
 */
export function invoiceTotals(
  lines: PreviewLine[],
  vatMode: "exclusive" | "none",
  vatRate: number,
  discountPercent = 0,
): Totals {
  let subtotal = 0;
  let discount = 0;
  let vat = 0;

  for (const l of lines) {
    const applies = vatMode === "exclusive" && l.vat_applicable;
    const gross = lineSubtotal(l.qty, l.unit_price);
    const off = lineDiscount(l.qty, l.unit_price, discountPercent);

    subtotal = round2(subtotal + gross);
    discount = round2(discount + off);
    vat = round2(vat + (applies ? round2(((gross - off) * num(vatRate)) / 100) : 0));
  }

  return { subtotal, discount, vat, total: round2(subtotal - discount + vat) };
}
