"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";

const itemSchema = z.object({
  product_id: z.string().uuid().nullable(),
  description: z.string().min(1, "Every line needs a description."),
  unit: z.string().min(1),
  qty: z.number().positive("Quantity must be greater than zero."),
  unit_price: z.number().min(0),
  vat_applicable: z.boolean(),
});

const schema = z.object({
  id: z.string().uuid().nullable(),
  customer_id: z.string().uuid("Choose a customer."),
  name: z.string().min(1, "Give the schedule a name."),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  interval_count: z.number().int().min(1).max(12),
  next_run_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first run date."),
  end_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  terms_days: z.number().int().min(0).max(365),
  vat_mode: z.enum(["exclusive", "none"]),
  customer_notes: z.string().nullable(),
  auto_issue: z.boolean(),
  items: z.array(itemSchema).min(1, "Add at least one line item."),
});

export type RecurringResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveRecurring(raw: unknown): Promise<RecurringResult> {
  await requireSession();

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  if (input.end_on && input.end_on < input.next_run_on) {
    return { ok: false, error: "The end date cannot be before the first run." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_recurring_invoice", {
    p_id: input.id,
    p_customer_id: input.customer_id,
    p_name: input.name,
    p_frequency: input.frequency,
    p_interval_count: input.interval_count,
    p_next_run_on: input.next_run_on,
    p_end_on: input.end_on,
    p_terms_days: input.terms_days,
    p_vat_mode: input.vat_mode,
    p_customer_notes: input.customer_notes,
    p_auto_issue: input.auto_issue,
    p_items: input.items,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/recurring");
  return { ok: true, id: data as string };
}

export async function setRecurringActive(id: string, isActive: boolean) {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase
    .from("recurring_invoices")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/recurring");
}

export async function deleteRecurring(id: string) {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.from("recurring_invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/recurring");
}
