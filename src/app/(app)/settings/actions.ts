"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { normalisePhone } from "@/lib/phone";

// Only async functions may be exported from a "use server" module.
export type FormState = { error: string | null; notice: string | null; ok: boolean };

function text(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function saveOrgSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return { error: "Only an administrator can change settings.", notice: null, ok: false };
  }

  const supabase = await createClient();

  const name = text(formData, "name");
  if (!name) return { error: "Business name is required.", notice: null, ok: false };

  const vatRate = Number(formData.get("default_vat_rate"));
  const terms = Number(formData.get("default_terms_days"));

  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return { error: "VAT rate must be between 0 and 100.", notice: null, ok: false };
  }
  if (!Number.isFinite(terms) || terms < 0 || terms > 365) {
    return { error: "Default terms must be between 0 and 365 days.", notice: null, ok: false };
  }

  const { error } = await supabase
    .from("orgs")
    .update({
      name,
      legal_name: text(formData, "legal_name"),
      tin: text(formData, "tin"),
      vrn: text(formData, "vrn"),
      address: text(formData, "address"),
      city: text(formData, "city"),
      phone: normalisePhone(text(formData, "phone")),
      email: text(formData, "email"),
      website: text(formData, "website"),
      // Only ever the default for NEW invoices — issued ones keep their own
      // snapshot, so changing this never rewrites history.
      default_vat_rate: vatRate,
      default_terms_days: Math.trunc(terms),
      bank_details: text(formData, "bank_details"),
      invoice_footer: text(formData, "invoice_footer"),
      reminder_language: String(formData.get("reminder_language") ?? "en") === "sw" ? "sw" : "en",
    })
    .eq("id", session.orgId);

  if (error) return { error: error.message, notice: null, ok: false };

  revalidatePath("/", "layout");
  return { error: null, notice: "Settings saved.", ok: true };
}

/**
 * Creates the account outright rather than emailing an invite — no SMTP to
 * configure, and you hand the person their password directly.
 */
export async function addTeamMember(formData: FormData): Promise<FormState> {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return { error: "Only an administrator can add team members.", notice: null, ok: false };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "sales") === "admin" ? "admin" : "sales";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address.", notice: null, ok: false };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", notice: null, ok: false };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "SUPABASE_SERVICE_ROLE_KEY is not configured, so accounts cannot be created from here.",
      notice: null,
      ok: false,
    };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "Could not create that account.";
    return {
      error: message.toLowerCase().includes("already")
        ? "An account with that email already exists."
        : message,
      notice: null,
      ok: false,
    };
  }

  const { error: memberError } = await admin.from("org_members").insert({
    org_id: session.orgId,
    user_id: created.user.id,
    role,
    full_name: fullName || null,
  });

  if (memberError) {
    // Don't leave an orphaned auth user behind if the membership failed.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: memberError.message, notice: null, ok: false };
  }

  revalidatePath("/settings/team");
  return {
    error: null,
    notice: `${email} can now sign in with the password you set.`,
    ok: true,
  };
}

export async function updateMemberRole(userId: string, role: "admin" | "sales") {
  const session = await requireAdmin();

  if (userId === session.userId) {
    throw new Error("You cannot change your own role.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("user_id", userId)
    .eq("org_id", session.orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/team");
}

export async function removeMember(userId: string) {
  const session = await requireAdmin();

  if (userId === session.userId) {
    throw new Error("You cannot remove yourself.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("org_members")
    .delete()
    .eq("user_id", userId)
    .eq("org_id", session.orgId);

  if (error) throw new Error(error.message);

  // Revoke sign-in too, otherwise they keep an account with no org.
  await admin.auth.admin.deleteUser(userId);
  revalidatePath("/settings/team");
}
