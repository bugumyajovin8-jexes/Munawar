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
const { customerBalances, invoiceBalance, paidByInvoice, isOverdue, paymentState, daysLate, ageing } = require(
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

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
