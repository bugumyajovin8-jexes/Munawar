"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { normalisePhone } from "@/lib/phone";

// A "use server" module may only export async functions — every export becomes
// a callable server reference. Types are erased so they are fine; a plain
// object is not, and breaks every action in the file at request time.
export type FormState = { error: string | null; ok: boolean };

function text(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

function int(fd: FormData, key: string, fallback: number): number {
  const n = Number(String(fd.get(key) ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function money(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function saveCustomer(formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const supabase = await createClient();

  const id = text(formData, "id");
  /*
   * A record created on this device brings its own id.
   *
   * Without one, the id is minted by Postgres on insert — which means a
   * customer added with no signal has no identity until it syncs, and nothing
   * created afterwards can point at it. You could not invoice someone you had
   * just added. The device generates a uuid up front instead, so an invoice
   * raised five minutes later offline already has something real to reference.
   *
   * Replay is safe because every queued write carries an idempotency key that
   * /api/sync records in client_ops before doing anything, so the same create
   * arriving twice is recognised rather than duplicated.
   */
  const clientId = text(formData, "client_id");
  const name = text(formData, "name");
  if (!name) return { error: "Customer name is required.", ok: false };

  const rawPhone = text(formData, "phone_e164");
  const phone = normalisePhone(rawPhone);
  if (rawPhone && !phone) {
    return {
      error: "That phone number does not look right. Use 0712 345 678 or +255 712 345 678.",
      ok: false,
    };
  }

  const email = text(formData, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address does not look right.", ok: false };
  }

  const terms = int(formData, "payment_terms_days", 30);
  if (terms < 0 || terms > 365) {
    return { error: "Payment terms must be between 0 and 365 days.", ok: false };
  }

  const row = {
    org_id: session.orgId,
    name,
    contact_person: text(formData, "contact_person"),
    phone_e164: phone,
    email,
    address: text(formData, "address"),
    city: text(formData, "city"),
    tin: text(formData, "tin"),
    vrn: text(formData, "vrn"),
    payment_terms_days: terms,
    credit_limit: money(formData, "credit_limit"),
    notes: text(formData, "notes"),
    is_active: formData.get("is_active") !== "false",
  };

  // Typed explicitly: the generated client infers the row shape from the
  // literal, so an id added conditionally reads to it as an excess property.
  const insertRow: typeof row & { id?: string } = clientId
    ? { ...row, id: clientId }
    : row;

  const { error } = id
    ? await supabase.from("customers").update(row).eq("id", id)
    : await supabase.from("customers").insert(insertRow);

  if (error) return { error: error.message, ok: false };

  revalidatePath("/customers");
  if (id) revalidatePath(`/customers/${id}`);
  return { error: null, ok: true };
}

export async function setCustomerActive(id: string, isActive: boolean) {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
