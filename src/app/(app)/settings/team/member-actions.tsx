"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeMember, updateMemberRole } from "../actions";
import type { UserRole } from "@/lib/types";

export function MemberActions({
  userId,
  name,
  role,
  isSelf,
}: {
  userId: string;
  name: string;
  role: UserRole;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">That&apos;s you</span>;
  }

  function changeRole(next: UserRole) {
    startTransition(async () => {
      try {
        await updateMemberRole(userId, next);
        toast.success(`${name} is now ${next === "admin" ? "an administrator" : "sales"}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not change the role.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        await removeMember(userId);
        setConfirmOpen(false);
        toast.success(`${name} removed`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not remove them.");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {role === "sales" ? (
            <DropdownMenuItem onSelect={() => changeRole("admin")}>
              <ShieldCheck />
              Make administrator
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => changeRole("sales")}>
              <UserRound />
              Change to sales
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2 />
            Remove from team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              Their sign-in is deleted straight away. Invoices they issued stay
              exactly as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
