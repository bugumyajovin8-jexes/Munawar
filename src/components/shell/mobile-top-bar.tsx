"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, Plus, Search, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/components/command-palette";
import { SyncStatus } from "@/components/offline/sync-status";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import type { UserRole } from "@/lib/types";

export function MobileTopBar({
  orgName,
  userName,
  email,
  role,
}: {
  orgName: string;
  userName: string;
  email: string;
  role: UserRole;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onInvoiceBuilder = pathname.startsWith("/invoices/new");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur lg:hidden print:hidden">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
        </DialogPrimitive.Trigger>

        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>

            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <BrandMark size={36} />
                <p className="truncate text-sm font-semibold text-sidebar-foreground">
                  {orgName}
                </p>
              </div>
              <DialogPrimitive.Close
                aria-label="Close menu"
                className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-accent"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-3">
              <NavLinks role={role} onNavigate={() => setOpen(false)} />
            </div>

            <div className="border-t border-sidebar-border p-3">
              {/* The bar's own chip hides itself when there is nothing to
                  report, so the drawer carries the always-available entry
                  point — mirroring the desktop sidebar. */}
              <SyncStatus />
              <UserMenu userName={userName} email={email} role={role} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{orgName}</p>

      {/* Only appears when there is something to say — see SyncStatus. */}
      <SyncStatus tone="compact" />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        onClick={() => openCommandPalette()}
      >
        <Search className="size-5" />
      </Button>

      {!onInvoiceBuilder && (
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/invoices/new">
            <Plus className="size-4" />
            New
          </Link>
        </Button>
      )}
    </header>
  );
}
