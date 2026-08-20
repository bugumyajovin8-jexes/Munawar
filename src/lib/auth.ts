import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Org, UserRole } from "./types";

export type AppSession = {
  userId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  orgId: string;
  org: Org;
};

/**
 * Cached per request, so a page that checks the role in three places still
 * only makes one round trip.
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member, error } = await supabase
    .from("org_members")
    .select("org_id, role, full_name, orgs(*)")
    .eq("user_id", user.id)
    .maybeSingle();

  // Swallowing this is how you end up bouncing between / and /onboarding with
  // no idea why: a failed read is indistinguishable from "no org yet" unless
  // the error is surfaced. Missing SELECT grants on org_members/orgs land here.
  if (error) {
    console.error(
      `[auth] could not read org membership for ${user.id}: ${error.message}` +
        (error.code ? ` (${error.code})` : ""),
    );
    return null;
  }

  if (!member?.org_id) return null;

  const org = (Array.isArray(member.orgs) ? member.orgs[0] : member.orgs) as Org | null;
  if (!org) {
    console.error(
      `[auth] membership found for ${user.id} but org ${member.org_id} was not readable — check SELECT grants and RLS on public.orgs`,
    );
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: member.full_name ?? null,
    role: member.role as UserRole,
    orgId: member.org_id,
    org,
  };
});

/** True when signed in but not yet attached to an org — drives onboarding. */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) {
    const user = await getAuthUser();
    redirect(user ? "/onboarding" : "/login");
  }
  return session;
}

export async function requireAdmin(): Promise<AppSession> {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw new Error("Only an administrator can do that.");
  }
  return session;
}

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "admin";
}
