/*
 * Exercises the statement ledger in src/lib/ledger.ts.  `npm run test:statement`
 *
 * A statement is the one document a customer sits down with and checks. The
 * rule that matters most here is the one branches introduced: each branch gets
 * a ledger of its own, and those closing balances have to add up to the
 * customer's. They are built by the same function from a partition of the same
 * rows precisely so that they cannot drift — this is the test that says so.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, ".test-build-statement");

fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join("src", "lib", "ledger.ts"),
    "--outDir",
    ".test-build-statement",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" },
);

const require = createRequire(import.meta.url);
const { ledger } = require(path.join(outDir, "ledger.js"));

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });

const FROM = "2026-01-01";
const TO = "2026-12-31";

const inv = (id, number, date, total, branch_id = null, doc_type = "invoice") => ({
  id,
  number,
  doc_type,
  invoice_date: date,
  total,
  branch_id,
});

const pay = (invoice_id, date, amount) => ({
  invoice_id,
  paid_on: date,
  amount,
  method: "cash",
  reference: null,
});

function run(invoices, payments, from = FROM, to = TO) {
  const numberById = new Map(invoices.map((i) => [i.id, i.number]));
  const branchOf = new Map(invoices.map((i) => [i.id, i.branch_id]));
  return ledger(invoices, payments, from, to, numberById, branchOf);
}

// ------------------------------------------------------------- the basics --

{
  const r = run([inv("i1", "INV-1", "2026-03-01", 900_000)], [pay("i1", "2026-04-01", 700_000)]);
  check(
    "an invoice debits and a payment credits",
    r.openingBalance === 0 && r.closingBalance === 200_000 && r.lines.length === 2,
    JSON.stringify({ opening: r.openingBalance, closing: r.closingBalance }),
  );
}

{
  // Everything before the window rolls into the opening balance instead of
  // appearing as a line.
  const r = run(
    [inv("i0", "INV-0", "2025-11-02", 500_000), inv("i1", "INV-1", "2026-03-01", 900_000)],
    [],
  );
  check(
    "documents before the period become the opening balance",
    r.openingBalance === 500_000 && r.lines.length === 1 && r.closingBalance === 1_400_000,
    JSON.stringify({ opening: r.openingBalance, lines: r.lines.length }),
  );
}

{
  const r = run(
    [inv("c1", "CN-1", "2026-03-05", 250_000, null, "credit_note")],
    [],
  );
  check(
    "a credit note reduces the balance and carries no payment status",
    r.closingBalance === -250_000 && r.lines[0].status === null,
    JSON.stringify({ closing: r.closingBalance, status: r.lines[0].status }),
  );
}

// -------------------------------------------------------------- branches ---

{
  const r = run([inv("i1", "INV-1", "2026-03-01", 900_000, "b-mwanza")], [
    pay("i1", "2026-03-20", 400_000),
  ]);
  check(
    "a payment inherits the branch of the invoice it settles",
    r.lines.find((l) => l.kind === "payment").branchId === "b-mwanza",
    r.lines.find((l) => l.kind === "payment").branchId,
  );
}

{
  /*
   * The invariant the whole design rests on.
   *
   * Three branches plus head office, invoices and payments inside and outside
   * the window, and one credit note — the sub-ledgers must still add up to the
   * account.
   */
  const invoices = [
    inv("h0", "INV-0", "2025-12-10", 1_200_000),
    inv("h1", "INV-1", "2026-02-01", 450_000),
    inv("m0", "INV-2", "2025-11-11", 800_000, "b-mwanza"),
    inv("m1", "INV-3", "2026-03-01", 900_000, "b-mwanza"),
    inv("a1", "INV-4", "2026-04-15", 1_733.33, "b-arusha"),
    inv("a2", "CN-1", "2026-05-01", 500, "b-arusha", "credit_note"),
    inv("y1", "INV-5", "2026-06-30", 12_345.67, "b-mbeya"),
  ];
  const payments = [
    pay("h0", "2025-12-20", 200_000),
    pay("h1", "2026-02-15", 50_000),
    pay("m0", "2026-01-05", 300_000),
    pay("m1", "2026-03-20", 700_000),
    pay("a1", "2026-04-20", 733.33),
    pay("y1", "2026-07-01", 12_000),
  ];

  const whole = run(invoices, payments);

  const branchIds = [null, "b-mwanza", "b-arusha", "b-mbeya"];
  const groups = branchIds.map((id) =>
    run(
      invoices.filter((i) => i.branch_id === id),
      payments.filter(
        (p) => (invoices.find((i) => i.id === p.invoice_id)?.branch_id ?? null) === id,
      ),
    ),
  );

  const summed = Math.round(groups.reduce((s, g) => s + g.closingBalance, 0) * 100) / 100;
  check(
    "branch closing balances add up to the customer's",
    summed === whole.closingBalance,
    `groups=${summed} customer=${whole.closingBalance}`,
  );

  const openings = Math.round(groups.reduce((s, g) => s + g.openingBalance, 0) * 100) / 100;
  check(
    "so do the opening balances",
    openings === whole.openingBalance,
    `groups=${openings} customer=${whole.openingBalance}`,
  );

  const lineCount = groups.reduce((s, g) => s + g.lines.length, 0);
  check(
    "every line lands in exactly one branch, none lost or doubled",
    lineCount === whole.lines.length,
    `groups=${lineCount} customer=${whole.lines.length}`,
  );

  const invoiced = Math.round(groups.reduce((s, g) => s + g.totalInvoiced, 0) * 100) / 100;
  const paid = Math.round(groups.reduce((s, g) => s + g.totalPaid, 0) * 100) / 100;
  check(
    "and the invoiced and paid totals",
    invoiced === whole.totalInvoiced && paid === whole.totalPaid,
    `invoiced ${invoiced}/${whole.totalInvoiced}, paid ${paid}/${whole.totalPaid}`,
  );
}

{
  // A branch with nothing in the period still has an opening balance, and
  // reporting it as zero would understate what that branch owes.
  const r = run(
    [inv("m0", "INV-0", "2025-06-01", 400_000, "b-mwanza")],
    [],
  );
  check(
    "a branch that was quiet all period keeps its opening balance",
    r.openingBalance === 400_000 && r.lines.length === 0 && r.closingBalance === 400_000,
    JSON.stringify({ opening: r.openingBalance, closing: r.closingBalance }),
  );
}

// --------------------------------------------------------------- ordering --

{
  // Same-day: the invoice has to come before the payment that settles it, or
  // the balance column dips negative and back for no visible reason.
  const r = run([inv("i1", "INV-1", "2026-03-01", 100_000)], [pay("i1", "2026-03-01", 100_000)]);
  check(
    "an invoice sorts before a same-day payment",
    r.lines[0].kind === "invoice" && r.lines[1].kind === "payment" && r.lines[1].balance === 0,
    r.lines.map((l) => l.kind).join(" → "),
  );
}

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
