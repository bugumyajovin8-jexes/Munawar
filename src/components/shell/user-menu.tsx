"use client";

import Link from "next/link";
import { ChevronsUpDown, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOutbox } from "@/lib/offline/hooks";
import { purgeOfflineCaches } from "@/lib/offline/sw-client";
import { purgeMirror } from "@/lib/offline/sync";
import { signOut } from "@/app/login/actions";
import type { UserRole } from "@/lib/types";

export function UserMenu({
  userName,
  email,
  role,
  tone = "dark",
}: {
  userName: string;
  email: string;
  role: UserRole;
  tone?: "dark" | "light";
}) {
  const { items } = useOutbox();

  /**
   * Signing out wipes every page cached on this device — the next person to
   * pick up the phone must not be able to scroll back through these balances.
   *
   * The outbox is deliberately left alone. It belongs to this user, it is
   * stamped with their id, and throwing away a payment they recorded in the
   * field because they logged out would be the worst possible reading of
   * "sign out". They are told it is still there instead.
   */
  function handleSignOut() {
    void purgeOfflineCaches();
    // The mirror is this business's figures. It leaves with the person who
    // was reading them, or the next person to sign in on this phone inherits
    // every customer and balance.
    void purgeMirror();
    if (items.length > 0) {
      toast.info(
        `${items.length} ${items.length === 1 ? "change is" : "changes are"} still saved on this device`,
        { description: "Sign in again on this phone and they will send themselves." },
      );
    }
  }

  const initials = (userName || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/60",
          tone === "dark"
            ? "text-sidebar-foreground hover:bg-sidebar-accent"
            : "text-foreground hover:bg-accent",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials || <UserRound className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{userName}</span>
          <span
            className={cn(
              "block truncate text-xs",
              tone === "dark" ? "text-sidebar-muted" : "text-muted-foreground",
            )}
          >
            {role === "admin" ? "Administrator" : "Sales"}
          </span>
        </span>
        <ChevronsUpDown
          className={cn(
            "size-4 shrink-0 opacity-60",
            tone === "dark" ? "text-sidebar-muted" : "text-muted-foreground",
          )}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="text-sm font-medium text-foreground">{userName}</span>
          <span className="text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
        )}
        {role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/settings/team">
              <ShieldCheck />
              Team &amp; roles
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <form action={signOut} onSubmit={handleSignOut}>
          <button type="submit" className="w-full">
            <DropdownMenuItem variant="destructive" asChild>
              <span>
                <LogOut />
                Sign out
              </span>
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
