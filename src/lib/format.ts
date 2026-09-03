import { num } from "./money";

export const TZ = "Africa/Dar_es_Salaam";

/**
 * Today in Dar es Salaam, as YYYY-MM-DD.
 *
 * Never use `new Date()` directly for invoice dates: on a UTC server, 01:00
 * EAT is still the previous calendar day, which would date invoices a day
 * early and make them look overdue a day early too.
 */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Date-only strings from Postgres are "YYYY-MM-DD" — parse without any TZ shift. */
function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The only date format this app ever shows the user: DD/MM/YYYY. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateOnly(value) : value;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Add days to a YYYY-MM-DD string, returning the same format. */
export function addDays(isoDate: string, days: number): string {
  const d = parseDateOnly(isoDate) ?? new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseDateOnly(fromIso);
  const b = parseDateOnly(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * TZS amounts. Shillings are conventionally written without cents, so whole
 * numbers render clean and only genuinely fractional amounts show 2dp.
 */
export function formatMoney(value: unknown): string {
  const n = num(value);
  const fractional = Math.abs(n % 1) > 0.0001;
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: fractional ? 2 : 0,
  }).format(n);
}

export function formatTZS(value: unknown): string {
  return `TSh ${formatMoney(value)}`;
}

export function formatQty(value: unknown): string {
  const n = num(value);
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n);
}
