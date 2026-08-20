import { BarChart3, TrendingUp, Users, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { round2 } from "@/lib/money";
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
import { ReportControls } from "./report-controls";
import type { CustomerBalance, Invoice } from "@/lib/types";

export const metadata = { title: "Reports" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Row = Invoice & { customer: { id: string; name: string } | null };

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export default async function ReportsPage(props: PageProps<"/reports">) {
  const session = await requireSession();
  const supabase = await createClient();
  const isAdmin = session.role === "admin";
  const params = await props.searchParams;

  const today = todayLocal();
  const from =
    typeof params.from === "string" && DATE_RE.test(params.from)
      ? params.from
      : `${today.slice(0, 4)}-01-01`;
  const to =
    typeof params.to === "string" && DATE_RE.test(params.to) ? params.to : today;

  const [{ data: invoiceRows }, { data: ageingRows }, { data: paymentRows }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("*, customer:customers(id, name)")
        .eq("status", "issued")
        .gte("invoice_date", from)
        .lte("invoice_date", to)
        .order("invoice_date"),
      supabase.from("customer_balances").select("*").order("name"),
      supabase.from("payments").select("amount, paid_on").gte("paid_on", from).lte("paid_on", to),
    ]);

  const invoices = (invoiceRows ?? []) as unknown as Row[];
  const ageing = ((ageingRows ?? []) as CustomerBalance[]).filter((c) => c.balance !== 0);

  // Profit needs the per-line cost snapshot, which only admins can read.
  const profitByInvoice = new Map<string, number>();
  if (isAdmin && invoices.length > 0) {
    const { data: items } = await supabase
      .from("invoice_items_view")
      .select("invoice_id, line_profit")
      .in(
        "invoice_id",
        invoices.map((i) => i.id),
      );
    for (const item of items ?? []) {
      const key = item.invoice_id as string;
      profitByInvoice.set(
        key,
        (profitByInvoice.get(key) ?? 0) + Number(item.line_profit ?? 0),
      );
    }
  }

  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total), 0);
  const totalVat = invoices.reduce((sum, i) => sum + Number(i.vat_amount), 0);
  const totalReceived = (paymentRows ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const totalProfit = [...profitByInvoice.values()].reduce((sum, p) => sum + p, 0);

  // Monthly roll-up
  const byMonth = new Map<string, { invoiced: number; profit: number; count: number }>();
  for (const inv of invoices) {
    const key = (inv.invoice_date ?? "").slice(0, 7);
    if (!key) continue;
    const bucket = byMonth.get(key) ?? { invoiced: 0, profit: 0, count: 0 };
    bucket.invoiced = round2(bucket.invoiced + Number(inv.total));
    bucket.profit = round2(bucket.profit + (profitByInvoice.get(inv.id) ?? 0));
    bucket.count += 1;
    byMonth.set(key, bucket);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const peakMonth = Math.max(1, ...months.map(([, m]) => m.invoiced));

  // Top customers by revenue in the window
  const byCustomer = new Map<string, { id: string; name: string; total: number; count: number }>();
  for (const inv of invoices) {
    if (!inv.customer) continue;
    const bucket = byCustomer.get(inv.customer.id) ?? {
      id: inv.customer.id,
      name: inv.customer.name,
      total: 0,
      count: 0,
    };
    bucket.total = round2(bucket.total + Number(inv.total));
    bucket.count += 1;
    byCustomer.set(inv.customer.id, bucket);
  }
  const topCustomers = [...byCustomer.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const ageingTotals = ageing.reduce(
    (acc, c) => ({
      balance: acc.balance + Number(c.balance),
      current: acc.current + Number(c.bucket_current),
      d30: acc.d30 + Number(c.bucket_1_30),
      d60: acc.d60 + Number(c.bucket_31_60),
      d90: acc.d90 + Number(c.bucket_61_90),
      older: acc.older + Number(c.bucket_90_plus),
    }),
    { balance: 0, current: 0, d30: 0, d60: 0, d90: 0, older: 0 },
  );

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
          value={formatTZS(totalInvoiced)}
          hint={`${invoices.length} invoices`}
          icon={<TrendingUp className="size-4" />}
        />
        <StatTile
          label="Received"
          value={formatTZS(totalReceived)}
          tone="success"
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="VAT charged"
          value={formatTZS(totalVat)}
          hint="Collected on behalf of TRA"
          icon={<BarChart3 className="size-4" />}
        />
        <StatTile
          label={isAdmin ? "Gross profit" : "Outstanding now"}
          value={formatTZS(
            isAdmin
              ? totalProfit
              : ageingTotals.balance,
          )}
          tone={isAdmin ? "success" : "default"}
          hint={
            isAdmin && totalInvoiced > 0
              ? `${((totalProfit / totalInvoiced) * 100).toFixed(1)}% margin`
              : undefined
          }
          icon={<TrendingUp className="size-4" />}
        />
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
                  { label: "Current", amount: ageingTotals.current },
                  { label: "1–30 days", amount: ageingTotals.d30 },
                  { label: "31–60 days", amount: ageingTotals.d60 },
                  { label: "61–90 days", amount: ageingTotals.d90 },
                  { label: "90+ days", amount: ageingTotals.older },
                ]}
              />
            </CardContent>
          </Card>

          {ageing.length === 0 ? (
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
                  {ageing.map((c) => (
                    <TableRow key={c.customer_id} className={rowLink}>
                      <TableCell>
                        <RowLink href={`/customers/${c.customer_id}/statement`}>
                          {c.name}
                        </RowLink>
                      </TableCell>
                      <TableCell className="text-right tabular font-medium">
                        {formatMoney(c.balance)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground sm:table-cell">
                        {formatMoney(c.bucket_current)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground md:table-cell">
                        {formatMoney(c.bucket_1_30)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground md:table-cell">
                        {formatMoney(c.bucket_31_60)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground lg:table-cell">
                        {formatMoney(c.bucket_61_90)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {c.bucket_90_plus > 0 ? (
                          <span className="font-medium text-destructive">
                            {formatMoney(c.bucket_90_plus)}
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
                    <TableCell className="font-semibold">{ageing.length} customers</TableCell>
                    <TableCell className="text-right tabular font-bold">
                      {formatMoney(ageingTotals.balance)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular sm:table-cell">
                      {formatMoney(ageingTotals.current)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">
                      {formatMoney(ageingTotals.d30)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">
                      {formatMoney(ageingTotals.d60)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular lg:table-cell">
                      {formatMoney(ageingTotals.d90)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(ageingTotals.older)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sales">
          {months.length === 0 ? (
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
                  {months.map(([key, m]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{monthLabel(key)}</TableCell>
                      <TableCell className="hidden w-40 sm:table-cell">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(m.invoiced / peakMonth) * 100}%` }}
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
                    <TableCell className="text-right tabular">{invoices.length}</TableCell>
                    <TableCell className="text-right tabular font-bold">
                      {formatMoney(totalInvoiced)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right tabular font-bold text-success">
                        {formatMoney(totalProfit)}
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="text-right tabular">
                        {totalInvoiced > 0
                          ? `${((totalProfit / totalInvoiced) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="customers">
          {topCustomers.length === 0 ? (
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
                  {topCustomers.map((c, index) => (
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
                        {totalInvoiced > 0
                          ? `${((c.total / totalInvoiced) * 100).toFixed(1)}%`
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
