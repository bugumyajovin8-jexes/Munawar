"use client";

import { useState } from "react";
import Link from "next/link";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RowAction, RowLink, rowLink } from "@/components/row-link";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { PaymentDialog } from "@/components/payment-dialog";
import type { PaymentState } from "@/lib/types";

export type CollectItem = {
  id: string;
  number: string;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  balance: number;
  paymentState: PaymentState;
  isOverdue: boolean;
  daysOverdue: number;
  customer: { id: string; name: string } | null;
};

export function CollectRow({ item }: { item: CollectItem }) {
  const [mode, setMode] = useState<"full" | "partial" | null>(null);

  return (
    <>
      <TableRow className={rowLink}>
        <TableCell>
          <RowLink href={`/invoices/${item.id}`} className="tabular">
            {item.number}
          </RowLink>
        </TableCell>

        <TableCell>
          {item.customer ? (
            <RowAction>
              <Link
                href={`/customers/${item.customer.id}`}
                className="hover:text-primary hover:underline"
              >
                {item.customer.name}
              </Link>
            </RowAction>
          ) : (
            "—"
          )}
        </TableCell>

        <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
          {formatDate(item.dueDate)}
        </TableCell>

        <TableCell>
          <InvoiceStatusBadge
            status="issued"
            paymentState={item.paymentState}
            isOverdue={item.isOverdue}
            daysOverdue={item.daysOverdue}
          />
        </TableCell>

        <TableCell className="hidden text-right tabular text-muted-foreground md:table-cell">
          {formatMoney(item.total)}
        </TableCell>

        <TableCell className="hidden text-right tabular text-success md:table-cell">
          {item.amountPaid > 0 ? formatMoney(item.amountPaid) : "—"}
        </TableCell>

        <TableCell className="text-right tabular font-semibold">
          {formatMoney(item.balance)}
        </TableCell>

        <TableCell>
          <RowAction className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setMode("full")}>
              Full paid
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("partial")}>
              Partial
            </Button>
          </RowAction>
        </TableCell>
      </TableRow>

      {/*
        Mounted only while open and keyed on the mode, so the dialog's state
        initialisers set it up correctly — "Full paid" opens prefilled with the
        balance, "Partial" opens with an empty amount ready to type into.
      */}
      {mode && (
        <PaymentDialog
          key={mode}
          initialMode={mode}
          open
          onOpenChange={(next) => {
            if (!next) setMode(null);
          }}
          invoiceId={item.id}
          invoiceNumber={item.number}
          total={item.total}
          amountPaid={item.amountPaid}
          balance={item.balance}
        />
      )}
    </>
  );
}

/** Phone layout — the eight-column table above is unusable at 375px. */
export function CollectCard({ item }: { item: CollectItem }) {
  const [mode, setMode] = useState<"full" | "partial" | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/invoices/${item.id}`}
            className="block truncate font-medium tabular hover:text-primary"
          >
            {item.number}
          </Link>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {item.customer?.name ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Due {formatDate(item.dueDate)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular font-semibold">{formatMoney(item.balance)}</p>
          {item.amountPaid > 0 && (
            <p className="tabular text-xs text-success">
              {formatMoney(item.amountPaid)} paid
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <InvoiceStatusBadge
          status="issued"
          paymentState={item.paymentState}
          isOverdue={item.isOverdue}
          daysOverdue={item.daysOverdue}
        />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setMode("full")}>
            Full paid
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("partial")}>
            Partial
          </Button>
        </div>
      </div>

      {mode && (
        <PaymentDialog
          key={mode}
          initialMode={mode}
          open
          onOpenChange={(next) => {
            if (!next) setMode(null);
          }}
          invoiceId={item.id}
          invoiceNumber={item.number}
          total={item.total}
          amountPaid={item.amountPaid}
          balance={item.balance}
        />
      )}
    </div>
  );
}
