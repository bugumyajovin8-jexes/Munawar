/**
 * Amount in words for the invoice PDF — expected on Tanzanian invoices and
 * the usual defence against a hand-altered figure.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];
const SCALES: [number, string][] = [
  [1_000_000_000, "Billion"],
  [1_000_000, "Million"],
  [1_000, "Thousand"],
];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (hundreds > 0) parts.push("and");
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = TENS[Math.floor(rest / 10)];
      const o = rest % 10;
      parts.push(o ? `${t}-${ONES[o]}` : t);
    }
  }
  return parts.join(" ");
}

function wholeToWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  let remaining = n;

  for (const [value, name] of SCALES) {
    const count = Math.floor(remaining / value);
    if (count > 0) {
      parts.push(`${underThousand(count)} ${name}`);
      remaining %= value;
    }
  }
  if (remaining > 0) parts.push(underThousand(remaining));

  return parts.join(" ");
}

/**
 * e.g. 1250000      -> "Tanzanian Shillings One Million Two Hundred and Fifty Thousand Only"
 *      1250000.50   -> "… Two Hundred and Fifty Thousand and Fifty Cents Only"
 */
export function amountInWords(value: number, currencyName = "Tanzanian Shillings"): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);

  let text = `${currencyName} ${wholeToWords(whole)}`;
  if (cents > 0) text += ` and ${wholeToWords(cents)} Cents`;
  text += " Only";

  return negative ? `Minus ${text}` : text;
}
