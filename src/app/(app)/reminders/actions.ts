"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

export type LogResult = { ok: true } | { ok: false; error: string };

/**
 * Records that a reminder went out, storing the exact text sent.
 *
 * With click-to-chat we cannot confirm delivery — this logs the moment you
 * opened WhatsApp with the message prepared. The UI says so rather than
 * implying a read receipt we do not have.
 */
export async function logReminder(input: {
  invoiceIds: string[];
  message: string;
  daysOverdue: number;
}): Promise<LogResult> {
  const session = await requireSession();
  const supabase = await createClient();

  if (input.invoiceIds.length === 0) {
    return { ok: false, error: "No invoices selected." };
  }

  const rows = input.invoiceIds.map((invoiceId) => ({
    org_id: session.orgId,
    invoice_id: invoiceId,
    channel: "whatsapp",
    sent_by: session.userId,
    days_overdue: input.daysOverdue,
    message_snapshot: input.message,
  }));

  const { error } = await supabase.from("reminders_log").insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reminders");
  for (const id of input.invoiceIds) revalidatePath(`/invoices/${id}`);
  return { ok: true };
}
