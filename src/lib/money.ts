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

export type Totals = {
  subtotal: number;
  vat: number;
  total: number;
};

/**
 * Mirrors the SQL exactly: round each line, then add the rounded lines up.
 * `vatMode === "none"` zeroes VAT regardless of the per-line flag, matching
 * save_draft_invoice().
 */
export function invoiceTotals(
  lines: PreviewLine[],
  vatMode: "exclusive" | "none",
  vatRate: number,
): Totals {
  let subtotal = 0;
  let vat = 0;

  for (const l of lines) {
    const applies = vatMode === "exclusive" && l.vat_applicable;
    subtotal = round2(subtotal + lineSubtotal(l.qty, l.unit_price));
    vat = round2(vat + lineVat(l.qty, l.unit_price, applies, vatRate));
  }

  return { subtotal, vat, total: round2(subtotal + vat) };
}
