import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import { SyncStatus } from "@/components/offline/sync-status";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import type { UserRole } from "@/lib/types";

export function AppSidebar({
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
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex print:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ReceiptText className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">
            {orgName}
          </p>
          <p className="text-xs text-sidebar-muted">Invoicing</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        <Button asChild className="w-full justify-start gap-2">
          <Link href="/invoices/new">
            <Plus className="size-4" />
            New invoice
          </Link>
        </Button>
        <CommandPalette role={role} />
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <NavLinks role={role} />
      </div>

      <div className="border-t border-sidebar-border p-3">
        <SyncStatus />
        <UserMenu userName={userName} email={email} role={role} />
      </div>
    </aside>
  );
}
