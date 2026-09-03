/*
 * Exercises the pull planner in src/lib/offline/sync-plan.ts.  `npm run test:sync`
 *
 * This is the logic that decides how far a sync has got, and every way it can
 * be wrong is invisible from inside the app. Advance a cursor too far and
 * records are skipped — no error, they simply never arrive. Fail to advance it
 * and the same page is fetched forever — no error, the mirror just stops
 * growing. Both look exactly like a working sync, which is how three earlier
 * offline bugs survived several rounds of "it seems fine".
 *
 * The last of those three is the reason the cursor is now per table, and the
 * simulation at the bottom of this file is the one that would have caught it.
 *
 * The planner is deliberately free of browser APIs so it can be compiled and
 * run here directly rather than mocked.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, ".test-build");

fs.rmSync(outDir, { recursive: true, force: true });
// tsc's entrypoint is invoked with this Node binary rather than through npx:
// on Windows, spawning a .cmd shim without a shell fails outright, and going
// through a shell to avoid that would be worse.
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join("src", "lib", "offline", "sync-plan.ts"),
    path.join("src", "lib", "offline", "retryable.ts"),
    path.join("src", "lib", "offline", "search-rank.ts"),
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
const { advance, newestIn, withKeys } = require(path.join(outDir, "sync-plan.js"));
const { isTransient, isRedirect } = require(path.join(outDir, "retryable.js"));
const { score, rank } = require(path.join(outDir, "search-rank.js"));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });
}

const CLOCK = "2026-08-18T10:00:00Z";
const warm = (since = CLOCK) => ({ since, cold: false });

function page(over) {
  return {
    changed: {},
    deleted: [],
    next: {},
    more: false,
    userId: "user-1",
    ...over,
  };
}

// ------------------------------------------------------------- the basics --

{
  const step = advance(
    page({ next: { customers: warm() } }),
    {},
    "user-1",
  );
  check(
    "a complete page finishes and stores what the server proposed",
    step.action === "done" && step.cursors.customers.since === CLOCK,
    JSON.stringify(step),
  );
}

{
  const step = advance(
    page({
      more: true,
      next: { invoices: { since: "2026-08-18T09:00:00Z", cold: true } },
    }),
    {},
    "user-1",
  );
  check(
    "a truncated page asks again from where the server left it",
    step.action === "more" && step.cursors.invoices.since === "2026-08-18T09:00:00Z",
    JSON.stringify(step),
  );
}

{
  const step = advance(
    page({ more: true, next: { invoices: warm("2026-01-01T00:00:00Z") } }),
    { invoices: warm("2026-06-01T00:00:00Z") },
    "user-1",
  );
  check(
    "a cursor is never walked backwards",
    step.cursors.invoices.since === "2026-06-01T00:00:00Z",
    step.cursors.invoices.since,
  );
}

{
  const step = advance(
    page({ more: true, next: { invoices: warm("2026-06-01T00:00:00Z") } }),
    { invoices: warm("2026-06-01T00:00:00Z") },
    "user-1",
  );
  check(
    "no forward progress on a full page is a stall, not a loop",
    step.action === "stalled",
    step.action,
  );
}

// Finishing the cold fill is progress even at the same instant: the table
// stops being windowed and becomes the unbounded delta.
{
  const step = advance(
    page({ more: true, next: { invoices: { since: CLOCK, cold: false } } }),
    { invoices: { since: CLOCK, cold: true } },
    "user-1",
  );
  check(
    "leaving the cold fill counts as moving forward",
    step.action === "more" && step.cursors.invoices.cold === false,
    JSON.stringify(step.cursors.invoices),
  );
}

// ----------------------------------------------------- unreadable tables ---

/*
 * The mistake that cost days: invoice_items_view was skipped on every sync
 * because it lacked the column the query ordered by, and the shared cursor
 * advanced anyway. Repairing the view changed nothing, because every device
 * had already strided past every line it had never been sent.
 */
{
  const step = advance(
    page({
      next: { customers: warm(), invoiceItems: null },
      skipped: [{ table: "invoiceItems", reason: "permission denied" }],
    }),
    { invoiceItems: warm("2025-01-01T00:00:00Z"), customers: warm("2025-01-01T00:00:00Z") },
    "user-1",
  );
  check(
    "a table nobody could read does not move",
    step.cursors.invoiceItems.since === "2025-01-01T00:00:00Z" &&
      step.cursors.customers.since === CLOCK,
    JSON.stringify(step.cursors),
  );
}

{
  const step = advance(page({ next: { customers: warm() } }), {}, "user-1");
  check(
    "a table absent from the response keeps whatever it had",
    step.cursors.invoiceItems === undefined,
    JSON.stringify(step.cursors),
  );
}

// ------------------------------------------------------- a different user --

{
  const step = advance(page({ userId: "user-2" }), { customers: warm() }, "user-1");
  check("another user signing in resets the mirror", step.action === "reset", step.action);
}

{
  const step = advance(page({ next: { customers: warm() } }), {}, null);
  check("first run is not a reset", step.action === "done", step.action);
}

// ------------------------------------------------------------- utilities --

{
  const max = newestIn([
    { updated_at: "2026-01-01T00:00:00Z" },
    { updated_at: "2026-09-09T00:00:00Z" },
    { updated_at: "2026-05-05T00:00:00Z" },
  ]);
  check("newest row is found in a set", max === "2026-09-09T00:00:00Z", max);
}

{
  const keyed = withKeys("customerPrices", [{ customer_id: "c1", product_id: "p1" }]);
  const untouched = withKeys("customers", [{ id: "c1" }]);
  check(
    "composite key derived only where it is needed",
    keyed[0].key === "c1:p1" && untouched[0].key === undefined,
    JSON.stringify([keyed[0], untouched[0]]),
  );
}

// ------------------------------------------------ the whole loop, for real --

/*
 * A business with more invoices than fit in one page, and a handful of
 * customers all touched today.
 *
 * This is the exact shape that broke the shared cursor. Customers come back
 * complete with a timestamp of "now"; invoices come back truncated at five
 * hundred with a timestamp from two years ago. One cursor across both jumps to
 * now, and every invoice in between is never asked for again — while the sync
 * reports success. Here the tables advance separately, so the loop keeps
 * asking for invoices until it genuinely runs out.
 */
{
  const PAGE = 500;
  const day = (n) => new Date(Date.UTC(2024, 0, 1 + n)).toISOString();

  const invoices = Array.from({ length: 1200 }, (_, i) => ({
    id: `inv-${i}`,
    updated_at: day(i),
  }));
  const customers = [0, 1, 2].map((i) => ({ id: `cus-${i}`, updated_at: day(1199) }));

  // A stand-in for /api/pull: each table limited on its own, exactly as the
  // route does it.
  function serve(cursors) {
    const changed = {};
    const next = {};
    let more = false;

    for (const [key, rows] of [
      ["invoices", invoices],
      ["customers", customers],
    ]) {
      const cursor = cursors[key];
      const matching = rows.filter((r) => !cursor || r.updated_at >= cursor.since);
      const sent = matching.slice(0, PAGE);
      changed[key] = sent;

      if (matching.length > PAGE) {
        more = true;
        next[key] = { since: newestIn(sent), cold: false };
      } else {
        next[key] = { since: "SERVER-CLOCK", cold: false };
      }
    }

    return page({ changed, next, more });
  }

  const seen = new Set();
  let cursors = {};
  let pages = 0;
  let action = "more";

  while (pages < 40) {
    const body = serve(cursors);
    for (const row of body.changed.invoices) seen.add(row.id);

    const step = advance(body, cursors, "user-1");
    action = step.action;
    if (action !== "more") break;

    cursors = step.cursors;
    pages += 1;
  }

  check(
    "every invoice arrives even when a small table is fresher than a big one",
    seen.size === invoices.length && action === "done",
    `${seen.size}/${invoices.length} after ${pages + 1} pages, ended ${action}`,
  );
}

// ------------------------------------------- worth retrying, or settled? ---

/*
 * The outbox stops the queue on a rejection and shows the item to a person.
 * That is right for a refusal and ruinous for a timeout: cash taken in a shop
 * sits blocked behind a problem that fixed itself. Both directions of this
 * mistake are expensive, so both are pinned here.
 */
{
  const transient = [
    Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    }),
    Object.assign(new Error("too many connections for role"), { code: "53300" }),
    Object.assign(new Error("could not serialize access"), { code: "40001" }),
    Object.assign(new Error("deadlock detected"), { code: "40P01" }),
    Object.assign(new Error("connection reset by peer"), { code: "08006" }),
    new Error("fetch failed"),
    new Error("socket hang up"),
    // PostgrestError is a plain object, not an Error.
    { code: "57P01", message: "terminating connection due to administrator command" },
  ];

  const failures = transient.filter((error) => !isTransient(error));
  check(
    "infrastructure failures are retried, not blocked",
    failures.length === 0,
    failures.map((e) => e.message).join(" | ") || "all retried",
  );
}

{
  const settled = [
    new Error("Only an administrator can add or edit products."),
    new Error("Enter an amount greater than zero."),
    new Error("That invoice number was never issued to this device."),
    Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    }),
    Object.assign(new Error("permission denied for table customer_prices"), {
      code: "42501",
    }),
    Object.assign(new Error("invalid input syntax for type numeric"), { code: "22P02" }),
    // Our own RAISE statements carry no SQLSTATE class of interest.
    Object.assign(new Error("You are not a member of any business."), { code: "P0001" }),
  ];

  const wrong = settled.filter((error) => isTransient(error));
  check(
    "a refusal is never mistaken for a bad connection",
    wrong.length === 0,
    wrong.map((e) => e.message).join(" | ") || "all settled",
  );
}

{
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/login;307;",
  });
  check(
    "an expired session is recognised, not reported as NEXT_REDIRECT",
    isRedirect(redirect) && !isRedirect(new Error("boom")),
    redirect.digest,
  );
}

// ------------------------------------------------------- search ordering ---

/*
 * The palette used to search the server. It now searches the device, which
 * makes it work offline and makes the ordering ours to get right — a search
 * that returns the right rows in the wrong order looks fine until somebody
 * types three letters, gets a stranger, and stops using it.
 */
{
  check(
    "a match at the start beats one in the middle",
    score(["Ali Hassan"], "ali") < score(["Natalia"], "ali"),
    `${score(["Ali Hassan"], "ali")} vs ${score(["Natalia"], "ali")}`,
  );
  check(
    "an earlier field beats a later one",
    score(["Ali Hassan", "0712"], "ali") < score(["Zawadi", "ali@x.com"], "ali"),
    `${score(["Ali Hassan", "0712"], "ali")} vs ${score(["Zawadi", "ali@x.com"], "ali")}`,
  );
  check("no match is null, not zero", score(["Zawadi"], "ali") === null, score(["Zawadi"], "ali"));
  check("a blank field is skipped, not matched", score([null, undefined, ""], "ali") === null, "null");

  // Matching on a joined field: an invoice found by its customer's name.
  const invoices = [
    { item: "INV-1", fields: ["INV-1", "DRAFT-1", "Zawadi"] },
    { item: "INV-2", fields: ["INV-2", "DRAFT-2", "Ali Hassan"] },
  ];
  check(
    "an invoice is found by its customer's name",
    rank(invoices, "ali", (x) => x).join(",") === "INV-2",
    rank(invoices, "ali", (x) => x).join(","),
  );

  const many = Array.from({ length: 20 }, (_, i) => ({
    item: `Ali ${String(i).padStart(2, "0")}`,
    fields: [`Ali ${String(i).padStart(2, "0")}`],
  }));
  const top = rank(many, "ali", (x) => x);
  check(
    "one crowded kind cannot fill the list",
    top.length === 5 && top[0] === "Ali 00",
    `${top.length}: ${top.join(", ")}`,
  );
}

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
