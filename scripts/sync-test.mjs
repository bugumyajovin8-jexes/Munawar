/*
 * Exercises the pull planner in src/lib/offline/sync-plan.ts.  `npm run test:sync`
 *
 * This is the logic that decides how far a sync has got, and every way it can
 * be wrong is invisible from inside the app. Advance the cursor too far and
 * records are skipped — no error, they simply never arrive. Fail to advance it
 * and the same page is fetched forever — no error, the mirror just stops
 * growing. Both look exactly like a working sync, which is how two earlier
 * offline bugs survived several rounds of "it seems fine".
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
const { nextStep, newestIn, withKeys } = require(
  path.join(outDir, "sync-plan.js"),
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });
}

function page(over) {
  return {
    cursor: "2026-08-18T10:00:00Z",
    truncated: false,
    changed: {},
    deleted: [],
    userId: "user-1",
    ...over,
  };
}

// A complete answer means the server's clock is a safe high-water mark.
{
  const step = nextStep(page(), null, "user-1");
  check(
    "complete page stores the server cursor",
    step.action === "done" && step.cursor === "2026-08-18T10:00:00Z",
    JSON.stringify(step),
  );
}

// A full page must resume from the newest row received, NOT the server clock.
{
  const step = nextStep(
    page({
      truncated: true,
      cursor: "2026-08-18T10:00:00Z",
      changed: {
        customers: [{ updated_at: "2026-08-01T00:00:00Z" }],
        invoices: [{ updated_at: "2026-08-03T00:00:00Z" }],
      },
    }),
    "2026-07-01T00:00:00Z",
    "user-1",
  );
  check(
    "truncated page resumes from the newest row, not the clock",
    step.action === "more" && step.since === "2026-08-03T00:00:00Z",
    JSON.stringify(step),
  );
}

// The dangerous case: a full page whose rows are all at the cursor already.
{
  const step = nextStep(
    page({
      truncated: true,
      changed: { customers: [{ updated_at: "2026-07-01T00:00:00Z" }] },
    }),
    "2026-07-01T00:00:00Z",
    "user-1",
  );
  check(
    "no forward progress is reported, not looped on",
    step.action === "stalled",
    JSON.stringify(step),
  );
}

// A full page carrying no timestamps at all must not loop either.
{
  const step = nextStep(
    page({ truncated: true, changed: { customers: [{}] } }),
    "2026-07-01T00:00:00Z",
    "user-1",
  );
  check("page without timestamps stalls", step.action === "stalled", JSON.stringify(step));
}

// Rows older than the cursor must never drag it backwards.
{
  const step = nextStep(
    page({
      truncated: true,
      changed: { customers: [{ updated_at: "2026-01-01T00:00:00Z" }] },
    }),
    "2026-07-01T00:00:00Z",
    "user-1",
  );
  check("cursor never moves backwards", step.action === "stalled", JSON.stringify(step));
}

// A different person signing in on this device must wipe, not merge.
{
  const step = nextStep(page({ userId: "user-2" }), "2026-07-01T00:00:00Z", "user-1");
  check(
    "another user signing in resets the mirror",
    step.action === "reset" && step.userId === "user-2",
    JSON.stringify(step),
  );
}

// First run has no owner recorded and must not be treated as a user change.
{
  const step = nextStep(page(), null, null);
  check("first run is not a reset", step.action === "done", JSON.stringify(step));
}

// newestIn looks across every table in the page, not just the first.
{
  const max = newestIn(
    page({
      changed: {
        a: [{ updated_at: "2026-01-01T00:00:00Z" }],
        b: [{ updated_at: "2026-09-09T00:00:00Z" }],
        c: [{ updated_at: "2026-05-05T00:00:00Z" }],
      },
    }),
  );
  check("newest row is found across all tables", max === "2026-09-09T00:00:00Z", max);
}

// customer_prices has no id column, so the mirror derives a composite key.
{
  const keyed = withKeys("customerPrices", [{ customer_id: "c1", product_id: "p1" }]);
  const untouched = withKeys("customers", [{ id: "c1" }]);
  check(
    "composite key derived only where it is needed",
    keyed[0].key === "c1:p1" && untouched[0].key === undefined,
    JSON.stringify([keyed[0], untouched[0]]),
  );
}

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
