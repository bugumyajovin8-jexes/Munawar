"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/page-header";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { RowAction, RowLink, rowLink } from "@/components/row-link";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { useAll, useSync } from "@/lib/offline/local";
import {
  daysLate,
  paidByInvoice,
  paymentState,
  round2,
  type MirrorPayment,
  type PaymentState,
} from "@/lib/offline/derive";
import { FilterTabs, type InvoiceFilter } from "./filter-tabs";
import type { Customer, Invoice } from "@/lib/types";

type Row = Invoice & {
  customer: { id: string; name: string } | null;
  paid: number;
  balance: number;
  state: PaymentState;
  overdue: boolean;
  lateDays: number;
};

/**
 * The invoice list, assembled on this device.
 *
 * Two things the server used to do have moved here. The customer name came
 * from a SQL join, and now comes from looking the customer up in the mirror —
 * there is no join to embed when both sides are IndexedDB stores. The balance
 * and status came from invoice_balances, a view, and are now derived from the
 * payments this device holds, which is what lets a payment taken with no
 * signal move a row from "unpaid" to "paid" straight away.
 */
export function InvoicesList() {
  const params = useSearchParams();
  const filter = (params.get("status") ?? "all") as InvoiceFilter;
  const query = params.get("q") ?? "";
  const today = todayLocal();

  const syncState = useSync();
  const invoices = useAll<Invoice>("invoices");
  const customers = useAll<Customer>("customers");
  const payments = useAll<MirrorPayment>("payments");

  const all = useMemo<Row[]>(() => {
    const names = new Map(customers.map((c) => [c.id, c]));
    const paidMap = paidByInvoice(payments);

    return [...invoices]
      // Newest first, matching what the server ordered by.
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((inv) => {
        const paid = paidMap.get(inv.id) ?? 0;
        const balance = round2(Number(inv.total) - paid);
        const customer = names.get(inv.customer_id);
        const late = inv.status === "issued" && balance > 0
          ? daysLate(inv.due_date, today)
          : 0;

        return {
          ...inv,
          customer: customer ? { id: customer.id, name: customer.name } : null,
          paid,
          balance,
          state: paymentState(Number(inv.total), paid),
          overdue: late > 0,
          lateDays: late,
        };
      });
  }, [invoices, customers, payments, today]);

  const counts = useMemo(
    () => ({
      all: all.length,
      draft: all.filter((i) => i.status === "draft").length,
      unpaid: all.filter((i) => i.status === "issued" && i.balance > 0).length,
      overdue: all.filter((i) => i.overdue).length,
      paid: all.filter((i) => i.status === "issued" && i.state === "paid").length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    let list = all;
    if (filter === "draft") list = list.filter((i) => i.status === "draft");
    if (filter === "unpaid")
      list = list.filter((i) => i.status === "issued" && i.balance > 0);
    if (filter === "overdue") list = list.filter((i) => i.overdue);
    if (filter === "paid")
      list = list.filter((i) => i.status === "issued" && i.state === "paid");

    const needle = query.trim().toLowerCase();
    if (!needle) return list;

    return list.filter(
      (i) =>
        (i.number ?? "").toLowerCase().includes(needle) ||
        i.draft_ref.toLowerCase().includes(needle) ||
        (i.customer?.name ?? "").toLowerCase().includes(needle),
    );
  }, [all, filter, query]);

  if (isColdEmpty(invoices.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const q = query;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterTabs active={filter} counts={counts} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={
            q || filter !== "all" ? "Nothing matches that view" : "No invoices yet"
          }
          description={
            q || filter !== "all"
              ? "Try a different filter or search term."
              : "Create your first invoice — it takes about twenty seconds."
          }
          action={
            !q && filter === "all" ? (
              <Button asChild>
                <Link href="/invoices/new">
                  <Plus className="size-4" />
                  New invoice
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id} className={rowLink}>
                    <TableCell>
                      <RowLink href={`/invoices/${inv.id}`} className="tabular">
                        {inv.number ?? inv.draft_ref}
                      </RowLink>
                    </TableCell>
                    <TableCell>
                      {inv.customer ? (
                        <RowAction>
                          <Link
                            href={`/customers/${inv.customer.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {inv.customer.name}
                          </Link>
                        </RowAction>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.invoice_date ?? inv.order_date)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.due_date)}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge
                        status={inv.status}
                        paymentState={inv.state}
                        isOverdue={inv.overdue}
                        daysOverdue={inv.lateDays}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(inv.total)}
                    </TableCell>
                    <TableCell className="text-right tabular font-medium">
                      {formatMoney(inv.balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-2.5 lg:hidden">
            {rows.map((inv) => (
              <Link key={inv.id} href={`/invoices/${inv.id}`} className="block">
                <Card className="p-4 transition-colors active:bg-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium tabular">
                        {inv.number ?? inv.draft_ref}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {inv.customer?.name ?? "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-medium">{formatMoney(inv.total)}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.due_date ? `Due ${formatDate(inv.due_date)}` : "Not issued"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <InvoiceStatusBadge
                      status={inv.status}
                      paymentState={inv.state}
                      isOverdue={inv.overdue}
                      daysOverdue={inv.lateDays}
                    />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
