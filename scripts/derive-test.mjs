/*
 * Exercises the balance arithmetic in src/lib/offline/derive.ts.  `npm run test:derive`
 *
 * These sums used to be a SQL view, checked by Postgres every time. Moving them
 * onto the device moved the risk with them: a rule applied in one place and
 * forgotten in another shows up as a wrong number on a customer's statement,
 * which is the one kind of bug this app cannot afford.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, ".test-build");

fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join("src", "lib", "offline", "derive.ts"),
    "--outDir",
    ".test-build",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" },
);

const require = createRequire(import.meta.url);
const { customerBalances, invoiceBalance, paidByInvoice, isOverdue, paymentState, daysLate, ageing, ageingByCustomer, formatDocumentNumber, grossProfit } = require(
  path.join(outDir, "derive.js"),
);

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });

const TODAY = "2026-08-18";
const inv = (over) => ({
  id: "i1",
  customer_id: "c1",
  total: 1000,
  status: "issued",
  due_date: "2026-09-01",
  ...over,
});

// --------------------------------------------------------- what is owed ----

{
  const b = customerBalances([inv()], [], TODAY);
  check("an unpaid invoice is owed in full", b.get("c1")?.balance === 1000, b.get("c1")?.balance);
}

{
  const b = customerBalances([inv()], [{ invoice_id: "i1", amount: 400 }], TODAY);
  check("a part payment reduces the balance", b.get("c1")?.balance === 600, b.get("c1")?.balance);
}

{
  const b = customerBalances([inv()], [{ invoice_id: "i1", amount: 1000 }], TODAY);
  check("a settled invoice owes nothing", b.get("c1") === undefined, "absent");
}

// A draft is something the user is still writing. Counting it as a debt would
// overstate what the business is due, which is the dangerous direction.
{
  const b = customerBalances([inv({ status: "draft" })], [], TODAY);
  check("a draft is not a debt", b.get("c1") === undefined, "absent");
}

{
  const b = customerBalances([inv({ status: "void" })], [], TODAY);
  check("a voided invoice is not a debt", b.get("c1") === undefined, "absent");
}

// Credit notes are stored as invoices with a negative total, so they subtract
// simply by being summed — no special case to forget.
{
  const b = customerBalances(
    [inv(), inv({ id: "i2", total: -300 })],
    [],
    TODAY,
  );
  check("a credit note subtracts", b.get("c1")?.balance === 700, b.get("c1")?.balance);
}

{
  const b = customerBalances([inv(), inv({ id: "i2", customer_id: "c2", total: 50 })], [], TODAY);
  check(
    "customers are kept apart",
    b.get("c1")?.balance === 1000 && b.get("c2")?.balance === 50,
    `${b.get("c1")?.balance} / ${b.get("c2")?.balance}`,
  );
}

// ------------------------------------------------------------ overdue ------

{
  const b = customerBalances([inv({ due_date: "2026-08-01" })], [], TODAY);
  check("a past due date is overdue", b.get("c1")?.overdue === 1000, b.get("c1")?.overdue);
}

// Due today is not yet late. Comparing ISO strings avoids the timezone trap
// where a device three hours ahead ages an invoice a day early.
{
  const b = customerBalances([inv({ due_date: TODAY })], [], TODAY);
  check("due today is not overdue", b.get("c1")?.overdue === 0, b.get("c1")?.overdue);
}

{
  const b = customerBalances(
    [inv({ due_date: "2026-08-01" })],
    [{ invoice_id: "i1", amount: 1000 }],
    TODAY,
  );
  check("a settled late invoice is not overdue", b.get("c1") === undefined, "absent");
}

{
  const b = customerBalances([inv({ due_date: null })], [], TODAY);
  check("no due date is never overdue", b.get("c1")?.overdue === 0, b.get("c1")?.overdue);
}

// -------------------------------------------------------- one invoice ------

{
  const r = invoiceBalance(inv(), [
    { invoice_id: "i1", amount: 300 },
    { invoice_id: "i1", amount: 200 },
    { invoice_id: "other", amount: 999 },
  ]);
  check(
    "payments sum, and other invoices are ignored",
    r.paid === 500 && r.balance === 500 && r.settled === false,
    JSON.stringify(r),
  );
}

{
  const r = invoiceBalance(inv(), [{ invoice_id: "i1", amount: 1200 }]);
  check("an overpayment reads as settled", r.settled === true && r.balance === -200, JSON.stringify(r));
}

// Payments are stored as numeric(14,2), so every amount arriving here already
// has two decimals. What must not happen is binary floating point turning an
// exact sum of them into 0.30000000000000004 on the customer's statement.
{
  const paid = paidByInvoice([
    { invoice_id: "i1", amount: 0.1 },
    { invoice_id: "i1", amount: 0.2 },
  ]);
  check("float drift is rounded away", paid.get("i1") === 0.3, paid.get("i1"));
}

{
  const paid = paidByInvoice(
    Array.from({ length: 10 }, () => ({ invoice_id: "i1", amount: 33.33 })),
  );
  check("many small payments stay exact", paid.get("i1") === 333.3, paid.get("i1"));
}

check(
  "isOverdue needs an actual balance",
  isOverdue(inv({ due_date: "2026-01-01" }), 0, TODAY) === false,
  "zero balance",
);

// --------------------------------------------------- badge + lateness ------

check("nothing paid reads as unpaid", paymentState(1000, 0) === "unpaid", paymentState(1000, 0));
check("some paid reads as partial", paymentState(1000, 400) === "partial", paymentState(1000, 400));
check("fully paid reads as paid", paymentState(1000, 1000) === "paid", paymentState(1000, 1000));
// Overpaid is certainly not still owing, which is what the badge is answering.
check("overpaid reads as paid", paymentState(1000, 1200) === "paid", paymentState(1000, 1200));

check("a future due date is not late", daysLate("2026-09-01", TODAY) === 0, daysLate("2026-09-01", TODAY));
check("due today is not late", daysLate(TODAY, TODAY) === 0, daysLate(TODAY, TODAY));
check("lateness counts whole days", daysLate("2026-08-11", TODAY) === 7, daysLate("2026-08-11", TODAY));
check("no due date is never late", daysLate(null, TODAY) === 0, daysLate(null, TODAY));

// ------------------------------------------------------------- ageing -----

{
  const a = ageing(
    [
      inv({ id: "a", due_date: "2026-09-01" }),          // not yet due
      inv({ id: "b", due_date: "2026-08-01" }),          // 17 days late
      inv({ id: "c", due_date: "2026-07-01" }),          // 48 days
      inv({ id: "d", due_date: "2026-06-01" }),          // 78 days
      inv({ id: "e", due_date: "2026-01-01" }),          // 229 days
    ],
    [],
    TODAY,
  );
  check(
    "debt lands in the right ageing buckets",
    a.current === 1000 && a.d1_30 === 1000 && a.d31_60 === 1000 &&
      a.d61_90 === 1000 && a.d90plus === 1000,
    JSON.stringify(a),
  );
  check("overdue count excludes what is not yet due", a.overdueCount === 4, a.overdueCount);
}

// The buckets must add up to the balance shown above them, or the report is
// visibly inconsistent with itself.
{
  const invoices = [
    inv({ id: "a", due_date: "2026-08-01" }),
    inv({ id: "b", total: 500, due_date: "2026-05-01" }),
  ];
  const a = ageing(invoices, [{ invoice_id: "a", amount: 250 }], TODAY);
  const sum = a.current + a.d1_30 + a.d31_60 + a.d61_90 + a.d90plus;
  const bal = customerBalances(invoices, [{ invoice_id: "a", amount: 250 }], TODAY);
  check("buckets sum to the customer balance", sum === bal.get("c1")?.balance, `${sum} vs ${bal.get("c1")?.balance}`);
}

// ------------------------------------------------- ageing by customer -----

/*
 * The aged-receivables table on /reports. It used to come from the
 * customer_balances SQL view, which meant the page could not be drawn without
 * a connection. The rows must still add up to the totals printed above them.
 */
{
  const invoices = [
    inv({ id: "a", customer_id: "c1", due_date: "2026-08-01" }),           // 17 days
    inv({ id: "b", customer_id: "c1", total: 500, due_date: "2026-01-01" }), // 229 days
    inv({ id: "c", customer_id: "c2", due_date: "2026-09-01" }),           // not due
    inv({ id: "d", customer_id: "c3", due_date: "2026-08-01" }),           // settled below
  ];
  const payments = [{ invoice_id: "d", amount: 1000 }];

  const rows = ageingByCustomer(invoices, payments, TODAY);
  const byId = new Map(rows.map((r) => [r.customerId, r]));

  check(
    "a settled customer is not listed as owing",
    !byId.has("c3"),
    rows.map((r) => r.customerId).join(","),
  );
  check(
    "each customer's debt lands in its own buckets",
    byId.get("c1").d1_30 === 1000 && byId.get("c1").d90plus === 500 &&
      byId.get("c2").current === 1000,
    JSON.stringify(rows),
  );
  check(
    "rows are ordered by who owes the most",
    rows[0].customerId === "c1",
    rows.map((r) => `${r.customerId}:${r.balance}`).join(" "),
  );

  // The whole point of sharing addToBucket with ageing().
  const total = ageing(invoices, payments, TODAY);
  const summed = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30: acc.d1_30 + r.d1_30,
      d31_60: acc.d31_60 + r.d31_60,
      d61_90: acc.d61_90 + r.d61_90,
      d90plus: acc.d90plus + r.d90plus,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
  );
  check(
    "the per-customer rows sum to the overall ageing",
    summed.current === total.current && summed.d1_30 === total.d1_30 &&
      summed.d31_60 === total.d31_60 && summed.d61_90 === total.d61_90 &&
      summed.d90plus === total.d90plus,
    `${JSON.stringify(summed)} vs ${JSON.stringify(total)}`,
  );
}

// ------------------------------------------------- document numbering -----
//
// These must match format_document_number() in 0008 exactly. A device issuing
// offline prints one of these before the server has seen it; if the two ever
// disagree, the customer's copy and the ledger's copy name different documents.

check(
  "an invoice number matches the database format",
  formatDocumentNumber("invoice", 2026, 42) === "INV-2026-0042",
  formatDocumentNumber("invoice", 2026, 42),
);
check(
  "credit notes and proformas keep their own prefixes",
  formatDocumentNumber("credit_note", 2026, 7) === "CN-2026-0007" &&
    formatDocumentNumber("proforma", 2026, 7) === "PRO-2026-0007",
  formatDocumentNumber("credit_note", 2026, 7),
);
// lpad only pads; it never truncates, and neither does padStart.
check(
  "numbers past four digits are not truncated",
  formatDocumentNumber("invoice", 2026, 12345) === "INV-2026-12345",
  formatDocumentNumber("invoice", 2026, 12345),
);

// -------------------------------------------------------- gross profit ----
//
// Zero is a real answer — you sold at cost. Reporting it when there is simply
// nothing to add up tells an owner their month was worthless.

{
  const r = grossProfit([{ invoice_id: "i1", line_profit: 400 }], new Set(["i1"]));
  check("profit sums the lines it has", r.value === 400, JSON.stringify(r));
}

{
  const r = grossProfit([{ invoice_id: "i1", line_profit: 0 }], new Set(["i1"]));
  check("selling at cost really is zero", r.value === 0, JSON.stringify(r));
}

{
  const r = grossProfit([], new Set());
  check("no invoices is not zero profit", r.value === null && r.reason === "no-invoices", JSON.stringify(r));
}

{
  const r = grossProfit([], new Set(["i1"]));
  check(
    "invoices without their lines reads as not synced",
    r.value === null && r.reason === "not-synced",
    JSON.stringify(r),
  );
}

// A sales role gets NULL cost from the view by design.
{
  const r = grossProfit([{ invoice_id: "i1", line_profit: null }], new Set(["i1"]));
  check(
    "lines with no cost read as no cost prices",
    r.value === null && r.reason === "no-cost-prices",
    JSON.stringify(r),
  );
}

// A locally-issued invoice has no line_profit key at all. Counting it as zero
// would drag a real figure down every time somebody invoiced offline.
{
  const r = grossProfit([{ invoice_id: "i1" }], new Set(["i1"]));
  check(
    "an unsynced line is not counted as zero profit",
    r.value === null && r.reason === "no-cost-prices",
    JSON.stringify(r),
  );
}

{
  const r = grossProfit(
    [{ invoice_id: "i1", line_profit: 500 }, { invoice_id: "i2" }],
    new Set(["i1", "i2"]),
  );
  check("known lines still count when one is unsynced", r.value === 500, JSON.stringify(r));
}

{
  const r = grossProfit(
    [{ invoice_id: "i1", line_profit: 300 }, { invoice_id: "other", line_profit: 999 }],
    new Set(["i1"]),
  );
  check("other periods are excluded", r.value === 300, JSON.stringify(r));
}

/*
 * A discount is given on the invoice as a whole and appears on no line, so
 * line margins alone report the profit that would have been made had it not
 * been discounted.
 */
{
  const r = grossProfit(
    [{ invoice_id: "i1", line_profit: 500 }],
    new Set(["i1"]),
    new Map([["i1", 200]]),
  );
  check("a discount is taken off the margin", r.value === 300, JSON.stringify(r));
}

{
  const r = grossProfit([{ invoice_id: "i1", line_profit: 500 }], new Set(["i1"]));
  check(
    "with no discounts passed, the figure is unchanged",
    r.value === 500,
    JSON.stringify(r),
  );
}

// An invoice whose lines came back without cost prices reported no margin at
// all. Subtracting its discount would invent a loss out of nothing.
{
  const r = grossProfit(
    [{ invoice_id: "i1", line_profit: 500 }, { invoice_id: "i2" }],
    new Set(["i1", "i2"]),
    new Map([["i2", 400]]),
  );
  check(
    "the discount of an uncounted invoice is not subtracted",
    r.value === 500,
    JSON.stringify(r),
  );
}

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
