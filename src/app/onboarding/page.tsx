import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { getAuthUser, getSession } from "@/lib/auth";
import { BrandMark } from "@/components/brand-mark";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // Already attached to an org — nothing to set up.
  const session = await getSession();
  if (session) redirect("/");

  /*
   * No session, but does the database think otherwise?
   *
   * current_org_id() is SECURITY DEFINER, so it reads org_members regardless
   * of grants and RLS. If it returns an org while getSession() came back null,
   * the row exists and the ordinary read of it is what's broken — showing the
   * signup form again would just loop forever on "already registered".
   */
  const supabase = await createClient();
  const { data: existingOrgId } = await supabase.rpc("current_org_id");

  if (existingOrgId) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <Card className="border-warning/40">
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-foreground dark:text-warning" />
                <div>
                  <h1 className="font-semibold">Your business was created</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The account is set up, but the app cannot read it back — so
                    it keeps sending you here. This is a database permission
                    problem, not something wrong with what you typed.
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">To fix it</p>
                <p className="mt-1 text-muted-foreground">
                  Open the Supabase dashboard → SQL Editor and run:
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-background p-2.5 font-mono text-xs">
                  {`grant select on public.orgs, public.org_members
  to authenticated;`}
                </pre>
                <p className="mt-2 text-muted-foreground">
                  Then reload this page. If it still loops, check that all four
                  migration files in{" "}
                  <code className="font-mono text-xs">supabase/migrations</code>{" "}
                  ran without errors, in order.
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                Organisation id:{" "}
                <code className="font-mono">{String(existingOrgId)}</code>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          {/*
            The full logo here too. Unlike sign-in, the heading below says
            something else entirely, so there is nothing to repeat.
          */}
          <BrandMark variant="full" size={64} alt="Munawar" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Set up your business
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This becomes the letterhead on every invoice you send. You can
              change all of it later in Settings.
            </p>
          </div>
        </div>

        <OnboardingForm />
      </div>
    </main>
  );
}
