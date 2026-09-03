/*
 * Exercises the invoice arithmetic in src/lib/money.ts.  `npm run test:money`
 *
 * This module exists to agree with recalc_invoice_totals() to the shilling.
 * It is the figure the user watches while typing, and the database recomputes
 * the same invoice the moment it is saved — so any disagreement shows up as a
 * total that changes after saving, on a document that has already been read
 * out to a customer.
 *
 * The rounding rule is the whole point: per line, then summed. The cases below
 * include one where that produces a different answer from rounding once at the
 * invoice level, because that is the only kind of test that can fail if
 * somebody "simplifies" it later.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, ".test-build-money");

fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join("src", "lib", "money.ts"),
    "--outDir",
    ".test-build-money",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" },
);

const require = createRequire(import.meta.url);
const { invoiceTotals, lineDiscount } = require(path.join(outDir, "money.js"));

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });

const line = (qty, unit_price, vat_applicable = true) => ({ qty, unit_price, vat_applicable });

// ---------------------------------------------------------------- no discount

{
  const t = invoiceTotals([line(2, 50_000)], "exclusive", 18);
  check(
    "without a discount nothing changes",
    t.subtotal === 100_000 && t.discount === 0 && t.vat === 18_000 && t.total === 118_000,
    JSON.stringify(t),
  );
}

{
  const t = invoiceTotals([line(2, 50_000)], "exclusive", 18, 0);
  check("a zero discount is the same as none", t.discount === 0 && t.total === 118_000, JSON.stringify(t));
}

// ------------------------------------------------------------------ discount

{
  // 10% of 100,000 is 10,000 off. VAT is 18% of the remaining 90,000.
  const t = invoiceTotals([line(2, 50_000)], "exclusive", 18, 10);
  check(
    "the discount comes off before VAT",
    t.subtotal === 100_000 && t.discount === 10_000 && t.vat === 16_200 && t.total === 106_200,
    JSON.stringify(t),
  );
}

{
  const t = invoiceTotals([line(1, 100_000)], "none", 18, 10);
  check(
    "with VAT off, the total is simply the discounted subtotal",
    t.discount === 10_000 && t.vat === 0 && t.total === 90_000,
    JSON.stringify(t),
  );
}

{
  // The zero-rated line is still discounted — a discount reduces what is being
  // charged; it is not a VAT adjustment — but contributes no VAT.
  const t = invoiceTotals([line(1, 100_000), line(1, 50_000, false)], "exclusive", 18, 10);
  check(
    "a line that carries no VAT is still discounted",
    t.subtotal === 150_000 && t.discount === 15_000 && t.vat === 16_200 && t.total === 151_200,
    JSON.stringify(t),
  );
}

// ------------------------------------------------------------------ rounding

{
  /*
   * The case that tells per-line rounding apart from rounding once.
   *
   * Three lines of 333.33 at 10%: each rounds to 33.33, summing to 99.99.
   * Rounding the invoice subtotal instead gives round(999.99 * 0.1) = 100.00.
   * The database does the former, so this must too.
   */
  const t = invoiceTotals([line(1, 333.33), line(1, 333.33), line(1, 333.33)], "none", 18, 10);
  check(
    "the discount is rounded per line, not once on the subtotal",
    t.subtotal === 999.99 && t.discount === 99.99 && t.total === 900,
    `${JSON.stringify(t)} (rounding once would give 100)`,
  );
}

{
  const t = invoiceTotals([line(3, 1_733.33), line(7, 419.99)], "exclusive", 18, 7.5);
  check(
    "subtotal minus discount plus VAT is always the total",
    t.total === Math.round((t.subtotal - t.discount + t.vat) * 100) / 100,
    JSON.stringify(t),
  );
}

{
  check(
    "a line's discount is zero when no discount was given",
    lineDiscount(4, 12_345.67, 0) === 0,
    lineDiscount(4, 12_345.67, 0),
  );
}

{
  // Fractional percentages are allowed; the field takes two decimal places.
  const t = invoiceTotals([line(1, 100_000)], "none", 18, 2.5);
  check("fractional percentages work", t.discount === 2_500 && t.total === 97_500, JSON.stringify(t));
}

console.table(results);
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
