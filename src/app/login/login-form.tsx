"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn, signUp, type AuthState } from "./actions";

const EMPTY: AuthState = { error: null, notice: null };

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const [state, action, pending] = useActionState(
    mode === "signin" ? signIn : signUp,
    EMPTY,
  );

  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@business.co.tz"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            />
          </div>

          {/*
            Only when creating an account.

            Asking twice is worth it exactly once: a typo in a password you are
            inventing locks you out of an account you have not used yet, and
            there is nothing to recognise the mistake against. Signing in has
            no such risk — the password either works or it does not — so asking
            there would be friction with nothing behind it.
          */}
          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm_password">Confirm password</Label>
              <PasswordInput
                id="confirm_password"
                name="confirm_password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Type it again"
              />
            </div>
          )}

          {state.error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          )}
          {state.notice && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              {state.notice}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-1 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Setting up for the first time?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}
