import { formatDate, formatMoney } from "./format";
import { waNumber } from "./phone";

/**
 * WhatsApp reminders.
 *
 * Today this is click-to-chat: we build the message and hand it to WhatsApp
 * via a wa.me link, and you press send. Free, no Meta business verification,
 * works from the phone in your pocket.
 *
 * The `ReminderProvider` seam exists so the WhatsApp Cloud API can be dropped
 * in later — true automated sending, at the cost of business verification and
 * pre-approved templates — without rewriting any calling code.
 */

export type ReminderLanguage = "en" | "sw";

export type InvoiceRef = {
  number: string;
  balance: number;
  dueDate: string | null;
  daysOverdue: number;
};

export type ReminderContext = {
  customerName: string;
  orgName: string;
  language: ReminderLanguage;
  invoices: InvoiceRef[];
};

/** A gentle nudge before the due date reads very differently from a chase. */
export type ReminderKind = "overdue" | "due_soon";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function bullet(inv: InvoiceRef, language: ReminderLanguage): string {
  const due = inv.dueDate ? formatDate(inv.dueDate) : "—";
  if (language === "sw") {
    return `• ${inv.number} — TSh ${formatMoney(inv.balance)} (ilipaswa ${due}, siku ${inv.daysOverdue} zimepita)`;
  }
  return `• ${inv.number} — TSh ${formatMoney(inv.balance)} (due ${due}, ${inv.daysOverdue} days late)`;
}

export function buildReminderMessage(
  kind: ReminderKind,
  ctx: ReminderContext,
): string {
  const { customerName, orgName, language, invoices } = ctx;
  const total = invoices.reduce((sum, i) => sum + i.balance, 0);
  const single = invoices.length === 1 ? invoices[0] : null;

  if (language === "sw") {
    if (kind === "due_soon" && single) {
      return [
        `Habari ${firstName(customerName)},`,
        "",
        `Ukumbusho kutoka ${orgName}: ankara namba ${single.number} ya TSh ${formatMoney(single.balance)} inatakiwa kulipwa tarehe ${single.dueDate ? formatDate(single.dueDate) : "—"}.`,
        "",
        `Tafadhali taja namba ya ankara ${single.number} unapolipa. Asante.`,
      ].join("\n");
    }

    if (single) {
      return [
        `Habari ${firstName(customerName)},`,
        "",
        `Huu ni ukumbusho kutoka ${orgName} kuhusu ankara namba ${single.number}.`,
        "",
        `Kiasi kinachodaiwa: TSh ${formatMoney(single.balance)}`,
        `Tarehe ya mwisho: ${single.dueDate ? formatDate(single.dueDate) : "—"}`,
        `Imepitiliza siku ${single.daysOverdue}`,
        "",
        `Tafadhali fanya malipo na utaje namba ya ankara ${single.number}. Asante.`,
      ].join("\n");
    }

    return [
      `Habari ${firstName(customerName)},`,
      "",
      `${orgName} — una ankara ${invoices.length} ambazo hazijalipwa, jumla TSh ${formatMoney(total)}:`,
      "",
      ...invoices.map((i) => bullet(i, "sw")),
      "",
      "Tafadhali fanya malipo ukitaja namba ya kila ankara. Asante.",
    ].join("\n");
  }

  if (kind === "due_soon" && single) {
    return [
      `Hello ${firstName(customerName)},`,
      "",
      `A reminder from ${orgName}: invoice ${single.number} for TSh ${formatMoney(single.balance)} falls due on ${single.dueDate ? formatDate(single.dueDate) : "—"}.`,
      "",
      `Please quote invoice ${single.number} when you pay. Thank you.`,
    ].join("\n");
  }

  if (single) {
    return [
      `Hello ${firstName(customerName)},`,
      "",
      `This is a reminder from ${orgName} about invoice ${single.number}.`,
      "",
      `Amount due: TSh ${formatMoney(single.balance)}`,
      `Due date: ${single.dueDate ? formatDate(single.dueDate) : "—"}`,
      `Now ${single.daysOverdue} days overdue`,
      "",
      `Please arrange payment and quote invoice ${single.number}. Thank you.`,
    ].join("\n");
  }

  return [
    `Hello ${firstName(customerName)},`,
    "",
    `${orgName} — you have ${invoices.length} overdue invoices totalling TSh ${formatMoney(total)}:`,
    "",
    ...invoices.map((i) => bullet(i, "en")),
    "",
    "Please arrange payment, quoting the invoice number for each. Thank you.",
  ].join("\n");
}

/**
 * "Here is your invoice" — sends a link rather than a PDF attachment, so the
 * customer sees live payment status and can download the PDF themselves.
 */
export function buildShareMessage(input: {
  customerName: string;
  orgName: string;
  language: ReminderLanguage;
  invoiceNumber: string;
  total: number;
  dueDate: string | null;
  url: string;
}): string {
  const { customerName, orgName, language, invoiceNumber, total, dueDate, url } = input;
  const due = dueDate ? formatDate(dueDate) : "—";

  if (language === "sw") {
    return [
      `Habari ${firstName(customerName)},`,
      "",
      `Ankara namba ${invoiceNumber} kutoka ${orgName}.`,
      "",
      `Jumla: TSh ${formatMoney(total)}`,
      `Tarehe ya mwisho ya malipo: ${due}`,
      "",
      `Iangalie hapa: ${url}`,
      "",
      `Tafadhali taja namba ${invoiceNumber} unapolipa. Asante.`,
    ].join("\n");
  }

  return [
    `Hello ${firstName(customerName)},`,
    "",
    `Here is invoice ${invoiceNumber} from ${orgName}.`,
    "",
    `Total: TSh ${formatMoney(total)}`,
    `Due: ${due}`,
    "",
    `View it here: ${url}`,
    "",
    `Please quote ${invoiceNumber} when you pay. Thank you.`,
  ].join("\n");
}

export interface ReminderProvider {
  readonly id: string;
  /** True when a human still has to press send in WhatsApp. */
  readonly requiresManualSend: boolean;
  /** Returns null when the customer has no usable phone number. */
  prepare(phoneE164: string | null, message: string): { url: string } | null;
}

export const clickToChatProvider: ReminderProvider = {
  id: "wa.me",
  requiresManualSend: true,
  prepare(phoneE164, message) {
    const digits = waNumber(phoneE164);
    if (!digits) return null;
    return { url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}` };
  },
};

export const reminderProvider: ReminderProvider = clickToChatProvider;
