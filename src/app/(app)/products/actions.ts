"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

// Only async functions may be exported from a "use server" module.
export type FormState = { error: string | null; ok: boolean };

function text(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

function money(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Admin-only, checked here as well as by RLS. Belt and braces: a sales user
 * who reached this action would still be rejected by the products_admin_*
 * policies, but failing early gives them a readable message instead of a
 * silent zero-row update.
 */
export async function saveProduct(formData: FormData): Promise<FormState> {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return { error: "Only an administrator can add or edit products.", ok: false };
  }

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
  if (!name) return { error: "Product name is required.", ok: false };

  const selling = money(formData, "selling_price");
  const buying = money(formData, "buying_price");

  if (selling <= 0) {
    return { error: "Enter a selling price greater than zero.", ok: false };
  }
  if (buying > selling) {
    return {
      error: "The buying price is higher than the selling price — every sale would lose money. Check the figures.",
      ok: false,
    };
  }

  const row = {
    org_id: session.orgId,
    sku: text(formData, "sku"),
    name,
    description: text(formData, "description"),
    unit: text(formData, "unit") ?? "pcs",
    selling_price: selling,
    buying_price: buying,
    vat_applicable: formData.get("vat_applicable") !== "false",
    is_active: formData.get("is_active") !== "false",
  };

  // Typed explicitly: the generated client infers the row shape from the
  // literal, so an id added conditionally reads to it as an excess property.
  const insertRow: typeof row & { id?: string } = clientId
    ? { ...row, id: clientId }
    : row;

  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert(insertRow);

  if (error) {
    if (error.code === "23505") {
      return { error: "Another product already uses that SKU.", ok: false };
    }
    return { error: error.message, ok: false };
  }

  revalidatePath("/products");
  return { error: null, ok: true };
}

export async function setProductActive(id: string, isActive: boolean) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
}
