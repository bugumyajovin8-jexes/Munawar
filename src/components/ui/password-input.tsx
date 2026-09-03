"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field you can look at.
 *
 * Typing a password blind on a phone keyboard is where most failed sign-ins
 * actually come from — not forgotten passwords, mistyped ones. Being able to
 * check what you typed removes that, and it matters more here than on a
 * desktop app: this is used one-handed, outdoors, often in a hurry.
 *
 * The toggle is a button rather than a checkbox so it never submits the form,
 * and it is excluded from the tab order: someone tabbing from the password
 * field expects to land on "Sign in", not on a control they did not ask for.
 * It stays reachable by clicking, and by tabbing backwards from the button.
 */
export function PasswordInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  const describedBy = useId();

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Room for the button, so a long password never runs underneath it.
        className={cn("pr-10", className)}
      />

      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-describedby={describedBy}
        className={cn(
          "absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md",
          "text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>

      {/* Announced on focus, so a screen reader user knows the state can be
          toggled at all — the icon alone says nothing to them. */}
      <span id={describedBy} className="sr-only">
        {visible ? "Password is visible" : "Password is hidden"}
      </span>
    </div>
  );
}
