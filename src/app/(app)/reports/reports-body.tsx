"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, TrendingUp, Users, Wallet } from "lucide-react";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatTile, AgeingBar } from "@/components/stat-tile";
import { RowLink, rowLink } from "@/components/row-link";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { useAll, useAppSession, useRelatedMany, useSync } from "@/lib/offline/local";
import {
  ageingByCustomer,
  grossProfit,
  round2,
  type MirrorItem,
  type MirrorPayment,
} from "@/lib/offline/derive";
import { ReportControls } from "./report-controls";
import type { Customer, Invoice } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

type DatedPayment = MirrorPayment & { paid_on?: string };

/**
 * Reports, computed on this device.
 *
 * Two things were wrong with fetching this from the server, beyond the round
 * trip. The date range meant a year of invoices with a customer join on every
 * visit; and the profit figure was gathered by handing every invoice id in
 * that range to an `in(...)` filter, which PostgREST puts in the URL. Several
 * hundred uuids is tens of kilobytes of query string, past what a proxy in
 * front of the database will accept — and the error was never checked, so when
 * it failed the page did not say so. It printed a gross profit of zero.
 *
 * That is the same failure the dashboard had, for the same reason, and it is
 * the reason grossProfit() returns null-with-a-reason rather than a number:
 * zero is a real answer meaning "you sold at cost", and it must not be what
 * "the figures did not arrive" looks like.
 */
export function ReportsBody() {
  const params = useSearchParams();
  const today = todayLocal();

  const session = useAppSession();
  const syncState = useSync();
  const invoices = useAll<Invoice>("invoices");
  const customers = useAll<Customer>("customers");
  const payments = useAll<DatedPayment>("payments");

  const isAdmin = session?.role === "admin";

  const fromParam = params.get("from");
  const toParam = params.get("to");
  const from =
    fromParam && DATE_RE.test(fromParam) ? fromParam : `${today.slice(0, 4)}-01-01`;
  const to = toParam && DATE_RE.test(toParam) ? toParam : today;

  // Lines for the invoices in range only — see the dashboard for why.
  const rangeInvoiceIds = useMemo(
    () =>
      invoices
        .filter(
          (i) =>
            i.status === "issued" &&
            i.invoice_date !== null &&
            i.invoice_date >= from &&
            i.invoice_date <= to,
        )
        .map((i) => i.id),
    [invoices, from, to],
  );
  const items = useRelatedMany<MirrorItem>(
    "invoiceItems",
    "invoice_id",
    rangeInvoiceIds,
    `${from}:${to}`,
  );

  const view = useMemo(() => {
    const names = new Map(customers.map((c) => [c.id, c]));

    // Issued invoices inside the window, by the date they were invoiced.
    const inRange = invoices.filter(
      (i) =>
        i.status === "issued" &&
        i.invoice_date !== null &&
        i.invoice_date >= from &&
        i.invoice_date <= to,
    );
    const rangeIds = new Set(inRange.map((i) => i.id));

    /*
     * Profit per invoice, from the line snapshots.
     *
     * Only lines that actually carry a figure count. A sales role gets NULL by
     * design and an unsynced local line has no such column at all, so `!= null`
     * rather than `!== null` — the same trap that made the dashboard read zero.
     */
    const profitByInvoice = new Map<string, number>();
    for (const item of items) {
      if (!rangeIds.has(item.invoice_id)) continue;
      if (item.line_profit == null) continue;
      profitByInvoice.set(
        item.invoice_id,
        round2((profitByInvoice.get(item.invoice_id) ?? 0) + Number(item.line_profit)),
      );
    }

    /*
     * A whole-invoice discount is on no line, so it has to be taken off the
     * invoice's margin by hand. Only for invoices that reported one at all —
     * an invoice with no cost prices is absent from the map and must stay
     * absent, rather than appearing with a negative margin made purely of its
     * discount.
     */
    const discountByInvoice = new Map<string, number>();
    for (const inv of inRange) {
      const given = Number(inv.discount_amount ?? 0);
      if (given <= 0) continue;
      discountByInvoice.set(inv.id, given);
      const margin = profitByInvoice.get(inv.id);
      if (margin != null) profitByInvoice.set(inv.id, round2(margin - given));
    }

    // The headline figure keeps its reason, so "unknown" cannot print as zero.
    const profit = grossProfit(items, rangeIds, discountByInvoice);

    const totalInvoiced = round2(
      inRange.reduce((sum, i) => sum + Number(i.total), 0),
    );
    const totalVat = round2(
      inRange.reduce((sum, i) => sum + Number(i.vat_amount ?? 0), 0),
    );
    const totalReceived = round2(
      payments
        .filter((p) => p.paid_on && p.paid_on >= from && p.paid_on <= to)
        .reduce((sum, p) => sum + Number(p.amount), 0),
    );

    // Monthly roll-up
    const byMonth = new Map<string, { invoiced: number; profit: number; count: number }>();
    for (const inv of inRange) {
      const key = (inv.invoice_date ?? "").slice(0, 7);
      if (!key) continue;
      const bucket = byMonth.get(key) ?? { invoiced: 0, profit: 0, count: 0 };
      bucket.invoiced = round2(bucket.invoiced + Number(inv.total));
      bucket.profit = round2(bucket.profit + (profitByInvoice.get(inv.id) ?? 0));
      bucket.count += 1;
      byMonth.set(key, bucket);
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Top customers by revenue in the window
    const byCustomer = new Map<
      string,
      { id: string; name: string; total: number; count: number }
    >();
    for (const inv of inRange) {
      const customer = names.get(inv.customer_id);
      if (!customer) continue;
      const bucket = byCustomer.get(customer.id) ?? {
        id: customer.id,
        name: customer.name,
        total: 0,
        count: 0,
      };
      bucket.total = round2(bucket.total + Number(inv.total));
      bucket.count += 1;
      byCustomer.set(customer.id, bucket);
    }

    /*
     * Ageing is deliberately not filtered by the date range. What somebody
     * owes you today is what they owe you today — an invoice from before the
     * window is still money outstanding, and hiding it would understate the
     * debt the page exists to show.
     */
    const ageingRows = ageingByCustomer(invoices, payments, today)
      .map((row) => ({ ...row, name: names.get(row.customerId)?.name ?? "—" }))
      .filter((row) => row.balance !== 0);

    const ageingTotals = ageingRows.reduce(
      (acc, c) => ({
        balance: round2(acc.balance + c.balance),
        current: round2(acc.current + c.current),
        d30: round2(acc.d30 + c.d1_30),
        d60: round2(acc.d60 + c.d31_60),
        d90: round2(acc.d90 + c.d61_90),
        older: round2(acc.older + c.d90plus),
      }),
      { balance: 0, current: 0, d30: 0, d60: 0, d90: 0, older: 0 },
    );

    return {
      count: inRange.length,
      totalInvoiced,
      totalVat,
      totalReceived,
      profit,
      months,
      peakMonth: Math.max(1, ...months.map(([, m]) => m.invoiced)),
      topCustomers: [...byCustomer.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 15),
      ageingRows,
      ageingTotals,
    };
  }, [invoices, customers, payments, items, from, to, today]);

  if (isColdEmpty(invoices.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const margin =
    view.profit.value !== null && view.totalInvoiced > 0
      ? `${((view.profit.value / view.totalInvoiced) * 100).toFixed(1)}% margin`
      : undefined;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${formatDate(from)} to ${formatDate(to)} · export any of these to Excel`}
      />

      <ReportControls from={from} to={to} today={today} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Invoiced"
          value={formatTZS(view.totalInvoiced)}
          hint={`${view.count} invoices`}
          icon={<TrendingUp className="size-4" />}
        />
        <StatTile
          label="Received"
          value={formatTZS(view.totalReceived)}
          tone="success"
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="VAT charged"
          value={formatTZS(view.totalVat)}
          hint="Collected on behalf of TRA"
          icon={<BarChart3 className="size-4" />}
        />
        {isAdmin ? (
          <StatTile
            label="Gross profit"
            /*
              A dash, never a zero, when the figure is not known. See
              grossProfit — the hint says which of the three reasons it is.
            */
            value={view.profit.value === null ? "—" : formatTZS(view.profit.value)}
            tone={view.profit.value === null ? "default" : "success"}
            hint={
              view.profit.value !== null
                ? margin
                : view.profit.reason === "no-invoices"
                  ? "Nothing issued in this period"
                  : view.profit.reason === "not-synced"
                    ? "Waiting for invoice lines to sync"
                    : "No buying prices recorded"
            }
            icon={<TrendingUp className="size-4" />}
          />
        ) : (
          <StatTile
            label="Outstanding now"
            value={formatTZS(view.ageingTotals.balance)}
            icon={<TrendingUp className="size-4" />}
          />
        )}
      </div>

      <Tabs defaultValue="ageing">
        <TabsList>
          <TabsTrigger value="ageing">Aged receivables</TabsTrigger>
          <TabsTrigger value="sales">Sales by month</TabsTrigger>
          <TabsTrigger value="customers">Top customers</TabsTrigger>
        </TabsList>

        <TabsContent value="ageing">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>How old the money owed to you is</CardTitle>
              <CardDescription>
                As at {formatDate(today)} — always current, independent of the
                date range above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgeingBar
                format={formatMoney}
                buckets={[
                  { label: "Current", amount: view.ageingTotals.current },
                  { label: "1–30 days", amount: view.ageingTotals.d30 },
                  { label: "31–60 days", amount: view.ageingTotals.d60 },
                  { label: "61–90 days", amount: view.ageingTotals.d90 },
                  { label: "90+ days", amount: view.ageingTotals.older },
                ]}
              />
            </CardContent>
          </Card>

          {view.ageingRows.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-5" />}
              title="Nobody owes you anything"
              description="Every issued invoice has been settled in full."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total owing</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Current</TableHead>
                    <TableHead className="hidden text-right md:table-cell">1–30</TableHead>
                    <TableHead className="hidden text-right md:table-cell">31–60</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">61–90</TableHead>
                    <TableHead className="text-right">90+</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.ageingRows.map((c) => (
                    <TableRow key={c.customerId} className={rowLink}>
                      <TableCell>
                        <RowLink href={`/customers/${c.customerId}/statement`}>
                          {c.name}
                        </RowLink>
                      </TableCell>
                      <TableCell className="text-right tabular font-medium">
                        {formatMoney(c.balance)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground sm:table-cell">
                        {formatMoney(c.current)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground md:table-cell">
                        {formatMoney(c.d1_30)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground md:table-cell">
                        {formatMoney(c.d31_60)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground lg:table-cell">
                        {formatMoney(c.d61_90)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {c.d90plus > 0 ? (
                          <span className="font-medium text-destructive">
                            {formatMoney(c.d90plus)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">
                      {view.ageingRows.length} customers
                    </TableCell>
                    <TableCell className="text-right tabular font-bold">
                      {formatMoney(view.ageingTotals.balance)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular sm:table-cell">
                      {formatMoney(view.ageingTotals.current)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">
                      {formatMoney(view.ageingTotals.d30)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">
                      {formatMoney(view.ageingTotals.d60)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular lg:table-cell">
                      {formatMoney(view.ageingTotals.d90)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(view.ageingTotals.older)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sales">
          {view.months.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="No invoices in this period"
              description="Widen the date range above."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="hidden sm:table-cell">Share</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    {isAdmin && <TableHead className="text-right">Gross profit</TableHead>}
                    {isAdmin && <TableHead className="text-right">Margin</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.months.map(([key, m]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{monthLabel(key)}</TableCell>
                      <TableCell className="hidden w-40 sm:table-cell">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(m.invoiced / view.peakMonth) * 100}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {m.count}
                      </TableCell>
                      <TableCell className="text-right tabular font-medium">
                        {formatMoney(m.invoiced)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right tabular text-success">
                          {formatMoney(m.profit)}
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-right tabular text-muted-foreground">
                          {m.invoiced > 0
                            ? `${((m.profit / m.invoiced) * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="text-right tabular">{view.count}</TableCell>
                    <TableCell className="text-right tabular font-bold">
                      {formatMoney(view.totalInvoiced)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right tabular font-bold text-success">
                        {view.profit.value === null ? "—" : formatMoney(view.profit.value)}
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="text-right tabular">{margin ?? "—"}</TableCell>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="customers">
          {view.topCustomers.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No sales in this period"
              description="Widen the date range above."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.topCustomers.map((c, index) => (
                    <TableRow key={c.id} className={rowLink}>
                      <TableCell className="tabular text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <RowLink href={`/customers/${c.id}`}>{c.name}</RowLink>
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {c.count}
                      </TableCell>
                      <TableCell className="text-right tabular font-medium">
                        {formatMoney(c.total)}
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {view.totalInvoiced > 0
                          ? `${((c.total / view.totalInvoiced) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
