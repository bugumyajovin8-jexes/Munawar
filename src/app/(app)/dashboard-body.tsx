"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Plus,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatDate, formatMoney, formatTZS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { InstallCard } from "@/components/offline/install-card";
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
import type { Customer, Invoice } from "@/lib/types";

type Row = Invoice & {
  customer: { id: string; name: string } | null;
  balance: number;
  state: PaymentState;
  overdueDays: number;
};

type MirrorItem = { invoice_id: string; line_profit: number | null };

/**
 * The dashboard, computed on this device.
 *
 * Everything here used to be four Supabase queries and two SQL views, which is
 * why the landing screen was the slowest one in the app — it was also the one
 * people open most. Now it is arithmetic over rows already on the phone, so it
 * paints at once and keeps working with no signal.
 *
 * Margin stays admin-only without needing a check here: invoice_items_view
 * returns line_profit as NULL for a sales role, so the mirror on their device
 * holds nulls and the figure simply never appears. The rule is enforced once,
 * before the data ever leaves the server.
 */
export function DashboardBody({
  isAdmin,
  today,
}: {
  isAdmin: boolean;
  today: string;
}) {
  const syncState = useSync();
  const invoicesRaw = useAll<Invoice>("invoices");
  const customers = useAll<Customer>("customers");
  const payments = useAll<MirrorPayment & { paid_on?: string }>("payments");
  const items = useAll<MirrorItem>("invoiceItems");

  const month = today.slice(0, 7);

  const view = useMemo(() => {
    const names = new Map(customers.map((c) => [c.id, c]));
    const paidMap = paidByInvoice(payments);

    const invoices: Row[] = [...invoicesRaw]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((inv) => {
        const paid = paidMap.get(inv.id) ?? 0;
        const balance = round2(Number(inv.total) - paid);
        const customer = names.get(inv.customer_id);
        return {
          ...inv,
          customer: customer ? { id: customer.id, name: customer.name } : null,
          balance,
          state: paymentState(Number(inv.total), paid),
          overdueDays:
            inv.status === "issued" && balance > 0 ? daysLate(inv.due_date, today) : 0,
        };
      });

    const issued = invoices.filter((i) => i.status === "issued");
    const drafts = invoices.filter((i) => i.status === "draft");
    const overdue = issued
      .filter((i) => i.overdueDays > 0)
      .sort((a, b) => b.overdueDays - a.overdueDays);

    const totalOwed = round2(
      issued.reduce((sum, i) => sum + (i.balance > 0 ? i.balance : 0), 0),
    );
    const totalOverdue = round2(overdue.reduce((sum, i) => sum + i.balance, 0));

    const monthInvoices = issued.filter((i) => i.invoice_date?.startsWith(month));
    const invoicedThisMonth = round2(
      monthInvoices.reduce((sum, i) => sum + Number(i.total), 0),
    );
    const receivedThisMonth = round2(
      payments
        .filter((p) => (p.paid_on ?? "").startsWith(month))
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
    );

    // Null rather than zero when there is nothing to measure: "no margin data"
    // and "no margin" are different statements and must not look alike.
    let profitThisMonth: number | null = null;
    if (isAdmin && monthInvoices.length > 0) {
      const ids = new Set(monthInvoices.map((i) => i.id));
      const relevant = items.filter((it) => ids.has(it.invoice_id));
      profitThisMonth = relevant.some((it) => it.line_profit !== null)
        ? round2(relevant.reduce((sum, it) => sum + Number(it.line_profit ?? 0), 0))
        : null;
    }

    return {
      drafts,
      overdue,
      unpaidCount: issued.filter((i) => i.balance > 0).length,
      monthCount: monthInvoices.length,
      totalOwed,
      totalOverdue,
      invoicedThisMonth,
      receivedThisMonth,
      profitThisMonth,
      recent: invoices.slice(0, 6),
    };
  }, [invoicesRaw, customers, payments, items, month, today, isAdmin]);

  if (isColdEmpty(invoicesRaw.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const {
    drafts,
    overdue,
    unpaidCount,
    monthCount,
    totalOwed,
    totalOverdue,
    invoicedThisMonth,
    receivedThisMonth,
    profitThisMonth,
    recent,
  } = view;

  return (
    <>

      {/* Hides itself once installed, or where the browser cannot install. */}
      <InstallCard />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Owed to you"
          value={formatTZS(totalOwed)}
          hint={`${unpaidCount} unpaid invoices`}
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="Overdue"
          value={formatTZS(totalOverdue)}
          tone={totalOverdue > 0 ? "destructive" : "default"}
          hint={
            overdue.length
              ? `${overdue.length} past their due date`
              : "Nothing past due — nice"
          }
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Invoiced this month"
          value={formatTZS(invoicedThisMonth)}
          hint={`${monthCount} invoices`}
          icon={<TrendingUp className="size-4" />}
        />
        <StatTile
          label={isAdmin ? "Gross profit this month" : "Received this month"}
          value={formatTZS(isAdmin ? (profitThisMonth ?? 0) : receivedThisMonth)}
          tone="success"
          hint={isAdmin ? `${formatTZS(receivedThisMonth)} received` : undefined}
          icon={<Wallet className="size-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Chasing payment
            </CardTitle>
            {overdue.length > 0 && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/invoices?status=overdue">
                  All
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing overdue. Every issued invoice is inside its terms.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {overdue.slice(0, 6).map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {inv.customer?.name ?? "—"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground tabular">
                          {inv.number} · due {formatDate(inv.due_date)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-sm font-medium">
                          {formatMoney(inv.balance)}
                        </p>
                        <p className="text-xs font-medium text-destructive">
                          {inv.overdueDays}d late
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-4" />
              Drafts waiting to ship
            </CardTitle>
            {drafts.length > 0 && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/invoices?status=draft">
                  All
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {drafts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No open drafts. Orders you save before shipping appear here.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {drafts.slice(0, 6).map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {inv.customer?.name ?? "—"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Ordered {formatDate(inv.order_date)}
                        </p>
                      </div>
                      <p className="shrink-0 tabular text-sm font-medium">
                        {formatMoney(inv.total)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent activity</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/invoices">
              All invoices
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description="Create your first invoice and this fills up."
              action={
                <Button asChild>
                  <Link href="/invoices/new">
                    <Plus className="size-4" />
                    New invoice
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-primary"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium tabular">
                        {inv.number ?? inv.draft_ref}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {inv.customer?.name ?? "—"}
                      </p>
                    </div>
                    <div className="hidden sm:block">
                      <InvoiceStatusBadge
                        status={inv.status}
                        paymentState={inv.state}
                        isOverdue={(inv.overdueDays > 0)}
                        daysOverdue={inv.overdueDays}
                      />
                    </div>
                    <p className="shrink-0 tabular text-sm font-medium">
                      {formatMoney(inv.total)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
