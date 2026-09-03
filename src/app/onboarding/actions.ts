"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/lib/phone";

export type OnboardingState = { error: string | null };

export async function createBusiness(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!name) return { error: "Enter your business name." };

  const supabase = await createClient();

  const { data: orgId, error } = await supabase.rpc("bootstrap_org", {
    p_org_name: name,
    p_full_name: fullName,
  });
  if (error) return { error: error.message };

  // Optional details captured on the same screen.
  const patch = {
    // Not asked for at signup any more; set later in Settings.
    phone: normalisePhone(String(formData.get("phone") ?? "")),
    email: String(formData.get("email") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
  };

  if (Object.values(patch).some(Boolean)) {
    await supabase.from("orgs").update(patch).eq("id", orgId);
  }

  revalidatePath("/", "layout");
  redirect("/");
}
