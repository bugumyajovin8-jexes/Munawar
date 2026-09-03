"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newId, submit } from "@/lib/offline/outbox";
import { applyLocal } from "@/lib/offline/sync";
import { branchRow } from "@/lib/offline/optimistic";
import { formFields } from "@/lib/offline/form";
import type { CustomerBranch } from "@/lib/types";

/**
 * Adding or editing one of a customer's locations.
 *
 * Everything here follows CustomerDialog, including the part that matters
 * most: the id is minted on this device, so a branch added in a shop with no
 * signal can be named on an invoice raised a minute later. Waiting for
 * Postgres to mint one would mean a branch that cannot be invoiced until the
 * connection comes back, which is the moment it is least likely to.
 */
export function BranchDialog({
  customerId,
  branch,
  trigger,
  open: controlledOpen,
  onOpenChange,
  initialName,
  askToKeep = false,
  onSaved,
}: {
  customerId: string;
  branch?: CustomerBranch;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Ask whether this branch is worth keeping.
   *
   * Only when the form is opened from an invoice. On the customer's own screen
   * the question answers itself — somebody managing the branch list is plainly
   * adding one to it — but a place delivered to once, in the middle of writing
   * an invoice, should not become a permanent entry unless it is wanted.
   *
   * It decides whether the branch is offered again, not whether it exists. The
   * row is written either way, because the invoice has to point at something
   * the statement can group by: a name alone would split into a new group the
   * first time anybody typed it differently, which is the exact failure the
   * table was chosen to prevent.
   */
  askToKeep?: boolean;
  /** Carried in from a picker where the name has already been typed once. */
  initialName?: string;
  /**
   * Hands back the row just written, not merely its id — a caller cannot look
   * it up yet, because the hook reading the mirror re-queries asynchronously.
   */
  onSaved?: (saved: CustomerBranch) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };

  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState(true);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim() || "Branch";

    const fields = formFields(formData);
    const id = branch?.id ?? newId();
    if (!branch) fields.client_id = id;
    fields.customer_id = customerId;
    if (askToKeep && !branch) fields.is_active = keep ? "true" : "false";

    startTransition(async () => {
      const saved = branchRow(id, fields);
      await applyLocal("customerBranches", [saved]);

      const result = await submit({
        kind: "branch.save",
        label: branch ? `Edit branch · ${name}` : `New branch · ${name}`,
        body: fields,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setError(null);
      setOpen(false);
      onSaved?.(saved as unknown as CustomerBranch);

      if (result.queued) {
        toast.success("Saved on this device", {
          description: `${name} can be invoiced now and will sync when you are back online.`,
        });
        return;
      }

      toast.success(branch ? "Branch updated" : "Branch added");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? "Edit branch" : "New branch"}</DialogTitle>
          <DialogDescription>
            A location you invoice separately. Its name is printed on invoices raised
            for it, and its account is shown on its own on their statement.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          {branch && <input type="hidden" name="id" value={branch.id} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="branch_name">Branch name *</Label>
              <Input
                id="branch_name"
                name="name"
                required
                defaultValue={branch?.name ?? initialName ?? ""}
                placeholder="Mwanza"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch_contact">Contact person</Label>
              <Input
                id="branch_contact"
                name="contact_person"
                defaultValue={branch?.contact_person ?? ""}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch_phone">
                Phone <span className="text-muted-foreground">(for WhatsApp)</span>
              </Label>
              <Input
                id="branch_phone"
                name="phone_e164"
                type="tel"
                inputMode="tel"
                defaultValue={branch?.phone_e164 ?? ""}
                placeholder="0712 345 678"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="branch_address">Address</Label>
              <Textarea
                id="branch_address"
                name="address"
                rows={2}
                defaultValue={branch?.address ?? ""}
                placeholder="Left blank, the invoice shows the customer's own address"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch_city">City</Label>
              <Input
                id="branch_city"
                name="city"
                defaultValue={branch?.city ?? ""}
                placeholder="Mwanza"
              />
            </div>
          </div>

          {askToKeep && !branch && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
              Keep this branch for next time
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {branch ? "Save changes" : "Add branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
