/*
 * Builds a workbook with src/lib/excel.ts and reads it back.  `npm run test:excel`
 *
 * Spreadsheet styling is written blind — nothing in this project can open the
 * result — so "it compiled" says almost nothing. A wrong fill or a malformed
 * formula produces a file that either looks wrong to the customer it was sent
 * to, or that Excel refuses outright with a repair prompt. Round-tripping the
 * file catches both.
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
    path.join("src", "lib", "excel.ts"),
    "--outDir",
    ".test-build",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--esModuleInterop",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" },
);

// `server-only` throws outside a React Server Component. It is a guard for the
// bundler, not behaviour under test.
const built = path.join(outDir, "excel.js");
fs.writeFileSync(
  built,
  fs.readFileSync(built, "utf8").replace(/require\("server-only"\);?/, ""),
);

const require = createRequire(import.meta.url);
const { buildWorkbook, TONE } = require(built);
const ExcelJS = require("exceljs");

const results = [];
const check = (name, pass, detail) =>
  results.push({ name, pass: pass ? "PASS" : "FAIL", detail: String(detail) });

const sheet = {
  name: "Statement",
  title: "Statement of Account — Ali Hassan Trading",
  subtitle: ["Munawar Traders Ltd", "Period: 01/08/2026 to 31/08/2026"],
  columns: [
    { header: "Date", key: "date", format: "date", width: 14 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Debit", key: "debit", format: "money", width: 16 },
    {
      header: "Payment status",
      // Deliberately narrower than the header text, as the real statement
      // export sets it — the header wraps rather than being padded out.
      key: "status",
      width: 15,
      tones: { "Fully paid": TONE.good, "Partly paid": TONE.warn, "Not paid": TONE.bad },
    },
    { header: "Still owing", key: "remaining", format: "money", width: 16 },
  ],
  rows: [
    { date: "2026-08-02", reference: "INV-2026-0041", debit: 450000, status: "Fully paid", remaining: null, late: 0 },
    { date: "2026-08-11", reference: "INV-2026-0042", debit: 300000, status: "Partly paid", remaining: 120000, late: 0 },
    { date: "2026-08-19", reference: "INV-2026-0043", debit: 90000, status: "Not paid", remaining: 90000, late: 12 },
  ],
  totals: { reference: "3 invoices", debit: 840000, remaining: 210000 },
  rowTone: (row) => (Number(row.late ?? 0) > 0 ? "danger" : null),
};

const bytes = await buildWorkbook([sheet]);

// The strongest check available: Excel refuses to open a malformed workbook,
// and so does exceljs.
const book = new ExcelJS.Workbook();
await book.xlsx.load(Buffer.from(bytes));
const ws = book.getWorksheet("Statement");

check("the workbook reads back", Boolean(ws), ws ? "parsed" : "unreadable");

// --------------------------------------------------------------- masthead --
{
  const title = ws.getRow(1).getCell(1);
  check(
    "the title is centred and bold",
    title.alignment?.horizontal === "center" && title.font?.bold === true,
    `${title.alignment?.horizontal}, bold=${title.font?.bold}`,
  );
  check(
    "the title spans the table",
    ws.getRow(1).getCell(5).isMerged,
    "merged to the last column",
  );

  // Row 2 is the business name; row 3 is a period note. They must not look
  // alike — the first says whose document this is.
  const business = ws.getRow(2).getCell(1);
  const note = ws.getRow(3).getCell(1);
  check(
    "the business name is bold and in its own colour",
    business.font?.bold === true &&
      business.font?.color?.argb !== TONE.muted &&
      business.font?.size > note.font?.size,
    `${business.font?.color?.argb}, bold=${business.font?.bold}, ${business.font?.size}pt`,
  );
  check(
    "the lines under it stay quiet",
    note.font?.bold !== true && note.font?.color?.argb === TONE.muted,
    `${note.font?.color?.argb}, bold=${note.font?.bold}`,
  );
}

// ---------------------------------------------------------------- layout ---
{
  const view = ws.views?.[0];
  check(
    "headers and the first column are frozen",
    view?.state === "frozen" && view.xSplit === 1 && view.ySplit > 0,
    JSON.stringify(view),
  );
  check(
    "the header row repeats when printed",
    ws.pageSetup?.printTitlesRow?.length > 0 && ws.pageSetup.orientation === "landscape",
    `${ws.pageSetup?.printTitlesRow} ${ws.pageSetup?.orientation}`,
  );
}

// ---------------------------------------------------------------- values ---
{
  // Header, then three data rows. Row 1 title, 2-3 subtitles, 4 rule, 5 blank.
  const headerRow = 6;
  check(
    "the header sits where the data starts",
    ws.getRow(headerRow).getCell(1).value === "Date",
    ws.getRow(headerRow).getCell(1).value,
  );

  /*
   * The autofilter button is drawn inside the header cell at its right edge.
   * A right-aligned header ends up underneath it — which is exactly what
   * happened to "Debit", "Credit" and "Still owing".
   */
  const moneyHeaders = [3, 5].map((c) => ws.getRow(headerRow).getCell(c));
  check(
    "money headers are not right-aligned under the filter arrow",
    moneyHeaders.every((cell) => cell.alignment?.horizontal === "left"),
    moneyHeaders.map((c) => c.alignment?.horizontal).join(", "),
  );
  // Auto-sized columns clear the filter arrow. Explicitly sized ones are the
  // caller's decision — headers wrap, so a narrow column costs a second line
  // rather than hiding the title.
  check(
    "auto-sized columns clear the filter arrow",
    sheet.columns.every(
      (col, i) => col.width !== undefined || ws.getColumn(i + 1).width >= col.header.length + 4,
    ),
    sheet.columns.map((c, i) => `${c.header}=${ws.getColumn(i + 1).width}`).join(" "),
  );
  check(
    "an explicit narrow width is respected, not padded out",
    ws.getColumn(4).width < "Payment status".length + 4,
    `Payment status = ${ws.getColumn(4).width}`,
  );
  check(
    "headers wrap so a narrow column still shows its title",
    ws.getRow(headerRow).getCell(4).alignment?.wrapText === true,
    ws.getRow(headerRow).getCell(4).alignment?.wrapText,
  );

  /*
   * The point of all the widths: the sheet has to be readable without
   * scrolling sideways. Roughly 120 width units is a laptop screen.
   */
  const totalWidth = sheet.columns.reduce(
    (sum, _c, i) => sum + ws.getColumn(i + 1).width,
    0,
  );
  check("the whole sheet fits on one screen", totalWidth <= 130, `${totalWidth} units`);

  /*
   * Excel's own default is Calibri 11. Anything under that reads as cramped in
   * a document people print and hand to customers, and this sheet used to sit
   * a point below it everywhere.
   */
  const body = ws.getRow(headerRow + 1).getCell(2);
  const head = ws.getRow(headerRow).getCell(2);
  check(
    "cell text is no smaller than Excel's own default",
    body.font?.size >= 11 && head.font?.size >= 11,
    `body ${body.font?.size}pt, header ${head.font?.size}pt`,
  );
  check(
    "rows are tall enough that larger type is not clipped",
    ws.getRow(headerRow).height >= 24 && ws.properties.defaultRowHeight >= 18,
    `header ${ws.getRow(headerRow).height}, default ${ws.properties.defaultRowHeight}`,
  );

  const first = ws.getRow(headerRow + 1);
  check(
    "dates round-trip as real dates, not text",
    first.getCell(1).value instanceof Date,
    typeof first.getCell(1).value,
  );
  check(
    "money round-trips as a number",
    typeof first.getCell(3).value === "number" && first.getCell(3).value === 450000,
    first.getCell(3).value,
  );
  check(
    "zero and blank print as a dash, not 0.00",
    String(first.getCell(5).numFmt).includes('"–"'),
    first.getCell(5).numFmt,
  );
}

// ----------------------------------------------------------------- tones ---
{
  const paid = ws.getRow(7).getCell(4);
  const unpaid = ws.getRow(9).getCell(4);
  check(
    "payment states carry their colour",
    paid.font?.color?.argb === TONE.good && unpaid.font?.color?.argb === TONE.bad,
    `${paid.font?.color?.argb} / ${unpaid.font?.color?.argb}`,
  );

  // Row 9 is the overdue one.
  const tinted = ws.getRow(9).getCell(1);
  check(
    "an overdue row is tinted",
    tinted.fill?.fgColor?.argb === "FFFEF2F2",
    tinted.fill?.fgColor?.argb,
  );

  // Row 8 is even-indexed in the data, so it carries the band.
  const banded = ws.getRow(8).getCell(1);
  check("alternate rows are banded", banded.fill?.fgColor?.argb === "FFF8FAFC", banded.fill?.fgColor?.argb);
}

// ---------------------------------------------------------------- totals ---
{
  const totals = ws.getRow(10);
  const debit = totals.getCell(3);
  check(
    "totals are live SUBTOTAL formulas, not frozen numbers",
    typeof debit.value === "object" && /^SUBTOTAL\(109,C7:C9\)$/.test(debit.value?.formula ?? ""),
    debit.value?.formula ?? JSON.stringify(debit.value),
  );
  check(
    "the cached result is still correct before recalculation",
    debit.value?.result === 840000,
    debit.value?.result,
  );
  check(
    "a text total is left as text",
    totals.getCell(2).value === "3 invoices",
    totals.getCell(2).value,
  );
}

console.table(results);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(results.every((r) => r.pass === "PASS") ? 0 : 1);
