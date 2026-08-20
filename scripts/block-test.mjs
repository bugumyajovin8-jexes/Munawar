/*
 * Exercises the number-block planner.  `npm run test:blocks`
 *
 * Both ways this can be wrong are expensive and neither shows up until someone
 * is standing in a shop. Ask for too many and every unused number is a
 * permanent gap in the customer's books. Ask for too few, or ask too late, and
 * the device runs dry with no signal and cannot issue at all.
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
    path.join("src", "lib", "offline", "block-plan.ts"),
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
const plan = require(path.join(outDir, "block-plan.js"));
const { needsMore, nextSize, burnRate, take, remaining, COLD_START_SIZE, MAX_SIZE, MIN_SIZE } = plan;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });
}

const block = (over = {}) => ({
  docType: "invoice",
  year: 2026,
  start: 100,
  end: 199,
  next: 100,
  ...over,
});

// --------------------------------------------------------- when to refill ---

check("a device with no block needs one", needsMore(null, 2026) === true, "null");
check(
  "a healthy block is left alone",
  needsMore(block(), 2026) === false,
  remaining(block()),
);
check(
  "a block down to its last fifth is topped up",
  needsMore(block({ next: 180 }), 2026) === true,
  remaining(block({ next: 180 })),
);
check(
  "an exhausted block is topped up",
  needsMore(block({ next: 200 }), 2026) === true,
  remaining(block({ next: 200 })),
);

// A block for last year is useless: numbering restarts each January, and a
// device offline across New Year would otherwise issue into the wrong year.
check(
  "last year's block does not count",
  needsMore(block({ year: 2025 }), 2026) === true,
  "2025 block in 2026",
);

// ------------------------------------------------------------- sizing ------

check(
  "a brand-new device gets the cold-start size",
  nextSize(null) === COLD_START_SIZE,
  nextSize(null),
);
check("a silent device is not given hundreds", nextSize(0) === COLD_START_SIZE, nextSize(0));

// 15 a month is half an invoice a day. A month's cover with safety is ~30 —
// emphatically not 500, which would leave a 470-number hole in the books.
{
  const size = nextSize(0.5);
  check("a quiet shop gets a small block", size >= MIN_SIZE && size <= 40, size);
}

// 40 a day is a busy depot; 50 numbers would not survive two days.
{
  const size = nextSize(40);
  check("a busy depot gets the maximum", size === MAX_SIZE, size);
}

check(
  "no size ever exceeds what the server will grant",
  nextSize(10_000) === MAX_SIZE,
  nextSize(10_000),
);

// --------------------------------------------------------- burn rate -------

const DAY = 86_400_000;
check(
  "one invoice on the first afternoon is not a trend",
  burnRate(1, Date.now() - DAY / 2, Date.now()) === null,
  "too little history",
);
check(
  "a real rate is measured once there is history",
  Math.abs(burnRate(20, Date.now() - 10 * DAY, Date.now()) - 2) < 0.001,
  burnRate(20, Date.now() - 10 * DAY, Date.now()),
);

// ---------------------------------------------------------- taking ---------

{
  const first = take(block(), 2026);
  const second = take(first.block, 2026);
  check(
    "numbers are handed out in order and never repeat",
    first.number === 100 && second.number === 101 && second.block.next === 102,
    `${first.number}, ${second.number}`,
  );
}

check(
  "an exhausted block refuses rather than inventing a number",
  take(block({ next: 200 }), 2026) === null,
  "next past end",
);

check(
  "the last number in the range is still usable",
  take(block({ next: 199 }), 2026)?.number === 199,
  "boundary",
);

check(
  "a block from another year refuses",
  take(block({ year: 2025 }), 2026) === null,
  "wrong year",
);

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
