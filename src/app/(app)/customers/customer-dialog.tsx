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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newId, submit } from "@/lib/offline/outbox";
import { applyLocal } from "@/lib/offline/sync";
import { customerRow } from "@/lib/offline/optimistic";
import { formFields } from "@/lib/offline/form";
import type { Customer } from "@/lib/types";

export function CustomerDialog({
  customer,
  trigger,
  defaultTermsDays = 30,
  open: controlledOpen,
  onOpenChange,
  initialName,
  onSaved,
}: {
  customer?: Customer;
  /** Omitted when the dialog is opened from elsewhere, e.g. a picker. */
  trigger?: ReactNode;
  defaultTermsDays?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Prefills the name. Someone who typed "Salam" into a picker and found
   * nothing has already told us the name; asking again in a blank form is a
   * question they have answered.
   */
  initialName?: string;
  /**
   * Hands back the row this dialog just wrote, not merely its id.
   *
   * A caller cannot look the record up yet: it has been written to the mirror,
   * but the hook that reads the mirror re-queries asynchronously, so at this
   * instant the picker's own list does not contain it. Passing the row removes
   * the race entirely rather than papering over it with a delay.
   */
  onSaved?: (saved: Customer) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Driven from the transition rather than an effect watching a result flag:
  // closing the dialog is a consequence of the submit, not of a render.
  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim() || "Customer";

    /*
     * A new customer is given its id here rather than by the database.
     *
     * That is what makes them usable straight away: an invoice raised five
     * minutes later, still with no signal, has a real id to reference. Waiting
     * for Postgres to mint one would mean a customer who cannot be invoiced
     * until the connection comes back.
     */
    const fields = formFields(formData);
    const id = customer?.id ?? newId();
    if (!customer) fields.client_id = id;

    startTransition(async () => {
      // Into the mirror before the network is even attempted, so the list has
      // them by the time this dialog closes.
      const saved = customerRow(id, fields);
      await applyLocal("customers", [saved]);

      const result = await submit({
        kind: "customer.save",
        label: customer ? `Edit customer · ${name}` : `New customer · ${name}`,
        body: fields,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      // Announced whether it reached the server or only the device: the id was
      // minted here either way, so a picker can select it immediately.
      onSaved?.(saved as unknown as Customer);

      if (result.queued) {
        toast.success("Saved on this device", {
          description: `${name} is ready to use now and will sync when you are back online.`,
        });
        // Queued means offline: refetching would only fail and bounce the
        // browser through a full reload of the same cached page. The mirror
        // has already been updated, so there is nothing to refetch anyway.
        return;
      }

      toast.success(customer ? "Customer updated" : "Customer added");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit customer" : "New customer"}</DialogTitle>
          <DialogDescription>
            Payment terms set here become the default due date on their invoices.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          {customer && <input type="hidden" name="id" value={customer.id} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="name">Customer name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={customer?.name ?? initialName ?? ""}
                placeholder="Ali Hassan Trading"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact_person">Contact person</Label>
              <Input
                id="contact_person"
                name="contact_person"
                defaultValue={customer?.contact_person ?? ""}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone_e164">
                Phone <span className="text-muted-foreground">(for WhatsApp)</span>
              </Label>
              <Input
                id="phone_e164"
                name="phone_e164"
                type="tel"
                inputMode="tel"
                defaultValue={customer?.phone_e164 ?? ""}
                placeholder="0712 345 678"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={customer?.email ?? ""}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                defaultValue={customer?.city ?? ""}
                placeholder="Dar es Salaam"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                name="address"
                rows={2}
                defaultValue={customer?.address ?? ""}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tin">TIN</Label>
              <Input id="tin" name="tin" defaultValue={customer?.tin ?? ""} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vrn">VRN</Label>
              <Input id="vrn" name="vrn" defaultValue={customer?.vrn ?? ""} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payment_terms_days">Payment terms (days)</Label>
              <Input
                id="payment_terms_days"
                name="payment_terms_days"
                type="number"
                min={0}
                max={365}
                inputMode="numeric"
                defaultValue={customer?.payment_terms_days ?? defaultTermsDays}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credit_limit">
                Credit limit <span className="text-muted-foreground">(TSh, 0 = none)</span>
              </Label>
              <Input
                id="credit_limit"
                name="credit_limit"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                defaultValue={customer?.credit_limit ?? 0}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default_discount_percent">
                Usual discount <span className="text-muted-foreground">(%, blank = none)</span>
              </Label>
              <Input
                id="default_discount_percent"
                name="default_discount_percent"
                type="number"
                min={0}
                max={99.99}
                step="0.01"
                inputMode="decimal"
                placeholder="0"
                /*
                 * Blank rather than 0 when there is none, matching the invoice
                 * field. A zero in the box reads as a decision somebody made.
                 */
                defaultValue={
                  customer?.default_discount_percent
                    ? Number(customer.default_discount_percent)
                    : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Fills in automatically on their invoices. You can change or clear it there.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                defaultValue={customer?.notes ?? ""}
                placeholder="Anything worth remembering about this customer"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {customer ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
