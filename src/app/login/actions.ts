"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null; notice: string | null };

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";

  if (!email || !password) {
    return { error: "Enter your email and password.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "That email and password do not match.", notice: null };
  }

  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!email || password.length < 8) {
    return {
      error: "Enter an email and a password of at least 8 characters.",
      notice: null,
    };
  }

  /*
   * Checked here as well as in the browser.
   *
   * The two fields match in the markup only because a browser chose to enforce
   * it; this action is reachable without one. More practically, the account is
   * created by the line below and there is no undo — a mismatch that slipped
   * through would lock somebody out of an account they had just made, with a
   * password neither they nor we can recover.
   */
  if (password !== confirm) {
    return { error: "The two passwords do not match.", notice: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message, notice: null };
  }

  // With email confirmation switched on there is no session yet.
  if (!data.session) {
    return {
      error: null,
      notice: "Check your inbox to confirm the address, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
