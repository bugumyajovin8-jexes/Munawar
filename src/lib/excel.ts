import "server-only";
import ExcelJS from "exceljs";

/**
 * Excel export.
 *
 * Dates are written as real Date values with a dd/mm/yyyy number format, and
 * money as real numbers — not pre-formatted strings. That matters: an
 * accountant who opens this needs to sort by date and sum a column, which
 * text masquerading as a date silently breaks.
 */

export type ColumnFormat = "text" | "money" | "date" | "number" | "percent";

export type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
  format?: ColumnFormat;
};

export type ExcelSheet = {
  name: string;
  title: string;
  subtitle?: string[];
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
  /** Rendered as a bold row under the data, keyed by column key. */
  totals?: Record<string, unknown>;
};

const NUM_FMT: Record<ColumnFormat, string> = {
  text: "@",
  money: "#,##0.00",
  date: "dd/mm/yyyy",
  number: "#,##0.###",
  percent: "0.0%",
};

const HEADER_FILL = "FF1E293B";
const ACCENT = "FF334155";

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return null;
}

function addSheet(workbook: ExcelJS.Workbook, sheet: ExcelSheet) {
  const ws = workbook.addWorksheet(sheet.name.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  const lastCol = sheet.columns.length;

  const titleRow = ws.addRow([sheet.title]);
  titleRow.font = { bold: true, size: 14, color: { argb: ACCENT } };
  ws.mergeCells(titleRow.number, 1, titleRow.number, Math.max(lastCol, 1));

  for (const line of sheet.subtitle ?? []) {
    const row = ws.addRow([line]);
    row.font = { size: 10, color: { argb: "FF64748B" } };
    ws.mergeCells(row.number, 1, row.number, Math.max(lastCol, 1));
  }

  ws.addRow([]);

  const headerRow = ws.addRow(sheet.columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  });
  headerRow.height = 20;

  const headerRowNumber = headerRow.number;

  for (const record of sheet.rows) {
    const values = sheet.columns.map((col) => {
      const raw = record[col.key];
      if (col.format === "date") return toDate(raw) ?? raw ?? null;
      if (col.format === "money" || col.format === "number" || col.format === "percent") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      return raw ?? null;
    });

    const row = ws.addRow(values);
    row.eachCell((cell, colNumber) => {
      const col = sheet.columns[colNumber - 1];
      if (!col) return;
      cell.numFmt = NUM_FMT[col.format ?? "text"];
      if (col.format === "money" || col.format === "number") {
        cell.alignment = { horizontal: "right" };
      }
    });
  }

  if (sheet.totals) {
    const values = sheet.columns.map((col) => {
      const raw = sheet.totals?.[col.key];
      if (raw === undefined || raw === null) return null;
      if (col.format === "money" || col.format === "number") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      return raw;
    });

    const row = ws.addRow(values);
    row.eachCell((cell, colNumber) => {
      const col = sheet.columns[colNumber - 1];
      cell.font = { bold: true };
      cell.border = { top: { style: "double", color: { argb: ACCENT } } };
      if (col) {
        cell.numFmt = NUM_FMT[col.format ?? "text"];
        if (col.format === "money" || col.format === "number") {
          cell.alignment = { horizontal: "right" };
        }
      }
    });
  }

  sheet.columns.forEach((col, index) => {
    ws.getColumn(index + 1).width =
      col.width ?? Math.max(12, Math.min(40, col.header.length + 6));
  });

  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + sheet.rows.length, column: lastCol },
    };
  }

  // Freeze everything above the first data row so headers stay put.
  ws.views = [{ state: "frozen", ySplit: headerRowNumber }];
}

export async function buildWorkbook(sheets: ExcelSheet[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Munawar Invoicing";
  workbook.created = new Date();

  for (const sheet of sheets) addSheet(workbook, sheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Excel-safe filename: no path separators, no reserved characters. */
export function safeFilename(base: string): string {
  return base
    .replace(/[^\w\d\-. ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function xlsxResponse(data: Uint8Array, filename: string): Response {
  return new Response(data as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeFilename(filename)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
