"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Copy, FileMinus, Loader2, MoreHorizontal, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { attempt } from "@/lib/attempt";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreditNoteDialog } from "./document-actions";
import { DeleteInvoiceButton } from "./delete-invoice";
import { VoidButton } from "./invoice-actions";
import { duplicateInvoice } from "../actions";
import type { Invoice, InvoiceItem } from "@/lib/types";

/**
 * Everything you do to an invoice occasionally.
 *
 * The header used to carry all of it at once — share, remind, take a payment,
 * print, delivery note, duplicate, credit note, void, delete. Nine buttons,
 * which on a phone is four rows of chrome before the invoice itself, and which
 * pushed the row wider than the screen until the layout was fixed underneath
 * it. Most of them are things a person does once in a while, and one of them
 * destroys the document.
 *
 * So the three or four done daily stay in the open, and the rest live here.
 *
 * The dialogs are rendered as siblings of the menu, never inside it. Closing a
 * dropdown unmounts its contents, so a dialog opened from within one would be
 * torn down in the same tick it appeared — which is why each of these takes
 * `open`/`onOpenChange` and this component holds the state.
 */
type Sheet = "credit" | "void" | "delete" | null;

export function InvoiceMoreMenu({
  invoice,
  items,
  label,
  isAdmin,
  isCreditNote,
  canVoid,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  label: string;
  isAdmin: boolean;
  isCreditNote: boolean;
  /** Void is refused once money or a credit note is attached to it. */
  canVoid: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Status decides most of this, and "not a draft" is not the same test as
   * "issued" — a voided document is neither. Voiding one twice, or shipping
   * goods against one, are both things the database would refuse anyway; the
   * point of checking here is not to offer them.
   */
  const isDraft = invoice.status === "draft";
  const isIssued = invoice.status === "issued";

  const canDeliver = isIssued && !isCreditNote;
  const canCredit = isAdmin && isIssued && !isCreditNote && items.length > 0;
  const canVoidNow = isAdmin && isIssued && canVoid;
  // A draft belongs to whoever is writing it; anything issued is an admin's.
  const canDelete = isAdmin || isDraft;

  function duplicate() {
    startTransition(async () => {
      const result = await attempt("copying this invoice", () =>
        duplicateInvoice(invoice.id),
      );
      if (!result) return;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Copied into a new draft");
      router.push(`/invoices/${result.invoiceId}/edit`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={`More actions for ${label}`}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          {canDeliver && (
            <DropdownMenuItem asChild>
              <Link href={`/invoices/${invoice.id}/delivery-note?auto=1`} target="_blank">
                <Truck />
                Delivery note
              </Link>
            </DropdownMenuItem>
          )}

          {!isCreditNote && (
            <DropdownMenuItem onSelect={duplicate}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
          )}

          {canCredit && (
            <DropdownMenuItem onSelect={() => setSheet("credit")}>
              <FileMinus />
              Credit note
            </DropdownMenuItem>
          )}

          {(canVoidNow || canDelete) && (canDeliver || canCredit || !isCreditNote) && (
            <DropdownMenuSeparator />
          )}

          {canVoidNow && (
            <DropdownMenuItem onSelect={() => setSheet("void")}>
              <Ban />
              Void
            </DropdownMenuItem>
          )}

          {/*
            Deleting a draft is open to anyone — it has no number, can hold no
            payment and is in nobody's books. Everything past that is an
            administrator's call, and 0011 enforces it regardless of this.
          */}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setSheet("delete")}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu, deliberately. See the note above. */}
      {canCredit && (
        <CreditNoteDialog
          invoiceId={invoice.id}
          invoiceNumber={label}
          items={items}
          open={sheet === "credit"}
          onOpenChange={(open) => setSheet(open ? "credit" : null)}
        />
      )}

      {canVoidNow && (
        <VoidButton
          invoice={invoice}
          open={sheet === "void"}
          onOpenChange={(open) => setSheet(open ? "void" : null)}
        />
      )}

      {canDelete && (
        <DeleteInvoiceButton
          invoice={invoice}
          open={sheet === "delete"}
          onOpenChange={(open) => setSheet(open ? "delete" : null)}
        />
      )}
    </>
  );
}
