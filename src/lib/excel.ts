import "server-only";
import ExcelJS from "exceljs";

/**
 * Excel export.
 *
 * Dates are written as real Date values with a dd/mm/yyyy number format, and
 * money as real numbers — not pre-formatted strings. That matters: an
 * accountant who opens this needs to sort by date and sum a column, which text
 * masquerading as a date silently breaks.
 *
 * The styling here is not decoration. Banded rows stop the eye slipping across
 * a dozen columns, a tinted row makes an overdue invoice findable without
 * reading, and the totals are live formulas so that filtering the sheet does
 * not leave a number at the bottom quietly describing rows that are no longer
 * shown.
 */

export type ColumnFormat = "text" | "money" | "date" | "number" | "percent";

/** Text colours available to a column's `tones` map. */
export const TONE = {
  good: "FF15803D",
  warn: "FFB45309",
  bad: "FFB91C1C",
  muted: "FF64748B",
} as const;

export type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
  format?: ColumnFormat;
  /**
   * Text colour per cell value — payment states, mostly.
   *
   * Kept as a map supplied by the caller rather than a format this file knows
   * about, so the spreadsheet builder never has to learn what an invoice is.
   */
  tones?: Record<string, string>;
};

export type ExcelSheet = {
  name: string;
  title: string;
  subtitle?: string[];
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
  /** Rendered as a bold row under the data, keyed by column key. */
  totals?: Record<string, unknown>;
  /** Tints a whole row — an overdue invoice, say. */
  rowTone?: (row: Record<string, unknown>) => "danger" | "warning" | null;
};

/**
 * Zero prints as a dash and negatives print red.
 *
 * A column of "0.00" is noise that has to be read before it can be dismissed;
 * a dash is dismissed at a glance. The red negative matters on statements,
 * where a credit genuinely reverses the sign.
 */
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00;"–"';

const NUM_FMT: Record<ColumnFormat, string> = {
  text: "@",
  money: MONEY_FMT,
  date: "dd/mm/yyyy",
  number: '#,##0.###;[Red]-#,##0.###;"–"',
  percent: "0.0%",
};

const HEADER_FILL = "FF1E293B";
const ACCENT = "FF334155";
/** The business's own line under the title — the one thing that is not grey. */
const BRAND = "FF4338CA";
const BAND_FILL = "FFF8FAFC";
const DANGER_FILL = "FFFEF2F2";
const WARNING_FILL = "FFFFFBEB";
const TOTAL_FILL = "FFF1F5F9";

/**
 * Type sizes.
 *
 * Excel's own default is Calibri 11, and the first version of this sheet set
 * everything a point below that to fit more on screen — which made a document
 * meant to be read across a desk, and often printed and handed to a customer,
 * smaller than the spreadsheets people already find cramped. Reading comes
 * first; there is a whole page of width to spend and only so much patience.
 */
const BODY_SIZE = 12;
const HEADER_SIZE = 12;
const NOTE_SIZE = 11;
const BODY_FONT = { name: "Calibri", size: BODY_SIZE } as const;

/**
 * Column widths are measured in characters of the workbook's *default* font,
 * not of the font actually in the cell. Setting 12pt text in a column sized
 * for 11pt silently loses the last character or two, so every width is scaled
 * to match.
 */
const WIDTH_SCALE = 1.15;

/** Rows have to grow with the type, or taller text is simply clipped. */
const ROW_HEIGHT = 20;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return null;
}

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function isNumeric(format: ColumnFormat | undefined): boolean {
  return format === "money" || format === "number" || format === "percent";
}

function addSheet(workbook: ExcelJS.Workbook, sheet: ExcelSheet) {
  const ws = workbook.addWorksheet(sheet.name.slice(0, 31), {
    properties: { defaultRowHeight: ROW_HEIGHT },
  });

  const lastCol = Math.max(sheet.columns.length, 1);

  // ------------------------------------------------------------- masthead --
  // Centred across the full width of the table, so the sheet reads as a
  // document with a heading rather than a grid that happens to start with
  // some text in cell A1.
  const titleRow = ws.addRow([sheet.title]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, lastCol);
  titleRow.height = 32;
  titleRow.getCell(1).font = {
    name: "Calibri",
    bold: true,
    size: 18,
    color: { argb: HEADER_FILL },
  };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

  /*
   * The first subtitle line is the business, and it is set apart.
   *
   * Every export puts the org name there, and it is the one line on the page
   * that says whose document this is — a customer receiving a statement reads
   * it before anything else. The lines beneath it are period and currency
   * notes, which are reference material and are styled as such.
   */
  (sheet.subtitle ?? []).forEach((line, index) => {
    const row = ws.addRow([line]);
    ws.mergeCells(row.number, 1, row.number, lastCol);

    row.getCell(1).font =
      index === 0
        ? { name: "Calibri", bold: true, size: 14, color: { argb: BRAND } }
        : { name: "Calibri", size: NOTE_SIZE, color: { argb: TONE.muted } };

    row.getCell(1).alignment = { horizontal: "center" };
    row.height = index === 0 ? 22 : 18;
  });

  // A rule under the masthead, drawn as a short row rather than a border on
  // the last subtitle — there may not be one.
  const rule = ws.addRow([]);
  rule.height = 6;
  for (let col = 1; col <= lastCol; col += 1) {
    rule.getCell(col).border = { bottom: { style: "medium", color: { argb: ACCENT } } };
  }

  ws.addRow([]);

  // -------------------------------------------------------------- headers --
  const headerRow = ws.addRow(sheet.columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: HEADER_SIZE,
    };
    cell.fill = fill(HEADER_FILL);
    /*
     * Every header is left-aligned, including the money ones.
     *
     * An earlier version right-aligned them so each header sat over its own
     * figures, which looks tidier and is unreadable: the autofilter button is
     * drawn inside the header cell against its right edge, so right-aligned
     * text ends up underneath the arrow. "Debit", "Credit" and "Still owing"
     * were all partly hidden by it.
     *
     * Aligning left puts the words at the opposite end of the cell from the
     * button, which cannot collide however narrow the column gets. The figures
     * below stay right-aligned, which is what actually matters for reading and
     * comparing amounts.
     */
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  headerRow.height = 28;

  const headerRowNumber = headerRow.number;
  const firstDataRow = headerRowNumber + 1;

  // ----------------------------------------------------------------- body --
  sheet.rows.forEach((record, index) => {
    const values = sheet.columns.map((col) => {
      const raw = record[col.key];
      if (col.format === "date") return toDate(raw) ?? raw ?? null;
      if (isNumeric(col.format)) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      return raw ?? null;
    });

    const row = ws.addRow(values);
    row.font = BODY_FONT;

    const tone = sheet.rowTone?.(record) ?? null;
    // A tinted row wins over the banding: it is carrying a meaning, and the
    // stripe is only there to help the eye track sideways.
    const background =
      tone === "danger"
        ? DANGER_FILL
        : tone === "warning"
          ? WARNING_FILL
          : index % 2 === 1
            ? BAND_FILL
            : null;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = sheet.columns[colNumber - 1];
      if (background) cell.fill = fill(background);
      if (!col) return;

      cell.numFmt = NUM_FMT[col.format ?? "text"];
      if (isNumeric(col.format)) cell.alignment = { horizontal: "right" };
      if (col.format === "date") cell.alignment = { horizontal: "center" };

      const toneColour = col.tones?.[String(cell.value ?? "")];
      if (toneColour) cell.font = { ...BODY_FONT, bold: true, color: { argb: toneColour } };
    });
  });

  // --------------------------------------------------------------- totals --
  if (sheet.totals) {
    const values = sheet.columns.map((col) => {
      const raw = sheet.totals?.[col.key];
      if (raw === undefined || raw === null) return null;
      if (isNumeric(col.format)) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      return raw;
    });

    const row = ws.addRow(values);
    row.height = 24;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = sheet.columns[colNumber - 1];
      cell.font = { name: "Calibri", bold: true, size: BODY_SIZE };
      cell.fill = fill(TOTAL_FILL);
      cell.border = { top: { style: "double", color: { argb: ACCENT } } };
      if (!col) return;

      cell.numFmt = NUM_FMT[col.format ?? "text"];
      if (isNumeric(col.format)) cell.alignment = { horizontal: "right" };

      /*
       * A live SUBTOTAL rather than the number we already worked out.
       *
       * 109 is "sum, ignoring rows hidden by a filter". The sheet ships with an
       * autofilter, so the moment somebody narrows it to one customer the old
       * fixed total would be describing rows that are no longer on screen —
       * quietly, and in a spreadsheet about money. The computed value is still
       * written as the cached result, so the figure is right even before Excel
       * recalculates.
       */
      if (isNumeric(col.format) && typeof cell.value === "number" && sheet.rows.length > 0) {
        const letter = ws.getColumn(colNumber).letter;
        cell.value = {
          formula: `SUBTOTAL(109,${letter}${firstDataRow}:${letter}${firstDataRow + sheet.rows.length - 1})`,
          result: cell.value,
        };
      }
    });
  }

  // ---------------------------------------------------------------- shape --
  sheet.columns.forEach((col, index) => {
    /*
     * An explicit width is taken as given; only auto-sized columns get padded.
     *
     * The +4 is room for the filter button, which is drawn inside the header
     * cell rather than beside it. That padding is the right default, but it
     * must not overrule a caller who has deliberately made a column narrow to
     * keep the whole sheet on one screen — headers wrap, so a long title in a
     * short column costs a second line rather than becoming unreadable.
     */
    const fitted = Math.max(12, Math.min(44, col.header.length + 6));
    const chosen = col.width ?? Math.max(fitted, col.header.length + 4);
    ws.getColumn(index + 1).width = Math.round(chosen * WIDTH_SCALE);
  });

  if (sheet.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + sheet.rows.length, column: lastCol },
    };
  }

  /*
   * Freeze the headers and the first column.
   *
   * Scrolling right on a wide sales report otherwise leaves you looking at a
   * row of figures with no idea which invoice they belong to.
   */
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowNumber }];

  /*
   * Statements get printed and handed to customers, and a multi-page one used
   * to lose its column headings after page one — leaving pages of unlabelled
   * numbers.
   */
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3,
    },
    printTitlesRow: `${headerRowNumber}:${headerRowNumber}`,
  };
  ws.headerFooter = {
    oddFooter: "&L&10&K64748B&F&C&10&K64748BPage &P of &N&R&10&K64748B&D",
  };
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
