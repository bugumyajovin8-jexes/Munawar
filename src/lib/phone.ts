/**
 * Phone numbers are stored in E.164 (+255…) from day one.
 *
 * This is the single most common thing that breaks WhatsApp integrations
 * later: wa.me and the Cloud API both need a bare international number, and
 * retrofitting a column full of "0712 345 678" and "+255-712-345678" is
 * miserable. Normalise on the way in, always.
 */

const TZ_COUNTRY_CODE = "255";

export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  let digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    // local form: 0712345678 -> 255712345678
    digits = TZ_COUNTRY_CODE + digits.slice(1);
  } else if (digits.length === 9) {
    // bare subscriber number: 712345678
    digits = TZ_COUNTRY_CODE + digits;
  }

  digits = digits.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return null;

  return `+${digits}`;
}

/** Pretty form for the UI: +255 712 345 678 */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = /^\+(\d{3})(\d{3})(\d{3})(\d{3})$/.exec(e164);
  if (!m) return e164;
  return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

/** wa.me wants the number with no plus and no separators. */
export function waNumber(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

export function isValidPhone(input: string | null | undefined): boolean {
  return normalisePhone(input) !== null;
}
