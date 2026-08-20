import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { addDays, formatDate, formatTZS, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { InvoiceRef } from "@/lib/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { ReminderButton } from "./reminder-dialog";
import type { Invoice, InvoiceBalance } from "@/lib/types";

export const metadata = { title: "Reminders" };

const DUE_SOON_WINDOW_DAYS = 7;

type Row = Invoice & {
  customer: {
    id: string;
    name: string;
    phone_e164: string | null;
  } | null;
  balance: InvoiceBalance | null;
};

type Group = {
  customerId: string;
  customerName: string;
  phone: string | null;
  rows: Row[];
  total: number;
  worstDays: number;
};

function groupByCustomer(rows: Row[]): Group[] {
  const map = new Map<string, Group>();

  for (const row of rows) {
    if (!row.customer) continue;
    const existing = map.get(row.customer.id);
    const balance = Number(row.balance?.balance ?? 0);
    const days = row.balance?.days_overdue ?? 0;

    if (existing) {
      existing.rows.push(row);
      existing.total += balance;
      existing.worstDays = Math.max(existing.worstDays, days);
    } else {
      map.set(row.customer.id, {
        customerId: row.customer.id,
        customerName: row.customer.name,
        phone: row.customer.phone_e164,
        rows: [row],
        total: balance,
        worstDays: days,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.worstDays - a.worstDays || b.total - a.total);
}

function toRefs(rows: Row[]): InvoiceRef[] {
  return rows.map((r) => ({
    number: r.number ?? r.draft_ref,
    balance: Number(r.balance?.balance ?? 0),
    dueDate: r.due_date,
    daysOverdue: r.balance?.days_overdue ?? 0,
  }));
}

export default async function RemindersPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const today = todayLocal();
  const horizon = addDays(today, DUE_SOON_WINDOW_DAYS);

  const [{ data: invoiceRows }, { data: balanceRows }, { data: reminderRows }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("*, customer:customers(id, name, phone_e164)")
        .eq("status", "issued")
        .order("due_date"),
      supabase.from("invoice_balances").select("*"),
      supabase
        .from("reminders_log")
        .select("invoice_id, sent_at")
        .order("sent_at", { ascending: false }),
    ]);

  const balances = new Map(
    ((balanceRows ?? []) as InvoiceBalance[]).map((b) => [b.invoice_id, b]),
  );

  // Ordered newest first, so the first hit per invoice is the latest reminder.
  const lastReminded = new Map<string, string>();
  for (const r of reminderRows ?? []) {
    const key = r.invoice_id as string;
    if (!lastReminded.has(key)) lastReminded.set(key, r.sent_at as string);
  }

  const all: Row[] = ((invoiceRows ?? []) as unknown as Row[]).map((i) => ({
    ...i,
    balance: balances.get(i.id) ?? null,
  }));

  const overdue = all.filter((i) => i.balance?.is_overdue);
  const dueSoon = all.filter(
    (i) =>
      !i.balance?.is_overdue &&
      Number(i.balance?.balance ?? 0) > 0 &&
      i.due_date !== null &&
      i.due_date >= today &&
      i.due_date <= horizon,
  );

  const overdueGroups = groupByCustomer(overdue);
  const dueSoonGroups = groupByCustomer(dueSoon);

  const totalOverdue = overdue.reduce(
    (sum, i) => sum + Number(i.balance?.balance ?? 0),
    0,
  );
  const oldest = overdue.reduce(
    (max, i) => Math.max(max, i.balance?.days_overdue ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Everything past due, grouped by customer, ready to send on WhatsApp."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Overdue"
          value={formatTZS(totalOverdue)}
          tone={totalOverdue > 0 ? "destructive" : "default"}
          hint={`${overdue.length} invoices · ${overdueGroups.length} customers`}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Oldest debt"
          value={oldest > 0 ? `${oldest} days` : "—"}
          hint={oldest > 90 ? "Past 90 days — chase hard" : "Days past the due date"}
          icon={<Clock className="size-4" />}
        />
        <StatTile
          label={`Due within ${DUE_SOON_WINDOW_DAYS} days`}
          value={formatTZS(
            dueSoon.reduce((sum, i) => sum + Number(i.balance?.balance ?? 0), 0),
          )}
          hint={`${dueSoon.length} invoices — nudge before they slip`}
          icon={<CalendarClock className="size-4" />}
        />
      </div>

      <Tabs defaultValue="overdue">
        <TabsList>
          <TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger>
          <TabsTrigger value="due_soon">Due soon ({dueSoon.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overdue">
          {overdueGroups.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="Nothing overdue"
              description="Every issued invoice is still inside its payment terms."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {overdueGroups.map((group) => (
                <CustomerGroup
                  key={group.customerId}
                  group={group}
                  kind="overdue"
                  orgName={session.org.name}
                  language={session.org.reminder_language}
                  lastReminded={lastReminded}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="due_soon">
          {dueSoonGroups.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nothing falling due this week"
              description={`Invoices due in the next ${DUE_SOON_WINDOW_DAYS} days appear here so you can nudge before they go late.`}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {dueSoonGroups.map((group) => (
                <CustomerGroup
                  key={group.customerId}
                  group={group}
                  kind="due_soon"
                  orgName={session.org.name}
                  language={session.org.reminder_language}
                  lastReminded={lastReminded}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function CustomerGroup({
  group,
  kind,
  orgName,
  language,
  lastReminded,
}: {
  group: Group;
  kind: "overdue" | "due_soon";
  orgName: string;
  language: "en" | "sw";
  lastReminded: Map<string, string>;
}) {
  const refs = toRefs(group.rows);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link
              href={`/customers/${group.customerId}`}
              className="font-medium hover:text-primary hover:underline"
            >
              {group.customerName}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {displayPhone(group.phone)}
              </span>
              <span className="tabular">
                {formatTZS(group.total)} across {group.rows.length}{" "}
                {group.rows.length === 1 ? "invoice" : "invoices"}
              </span>
            </p>
          </div>

          {group.rows.length > 1 && (
            <ReminderButton
              kind={kind}
              customerName={group.customerName}
              customerPhone={group.phone}
              orgName={orgName}
              language={language}
              invoices={refs}
              invoiceIds={group.rows.map((r) => r.id)}
              label={`Remind about all ${group.rows.length}`}
              variant="outline"
            />
          )}
        </div>

        <ul className="mt-3 flex flex-col divide-y divide-border border-t border-border">
          {group.rows.map((row) => {
            const last = lastReminded.get(row.id);
            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/invoices/${row.id}`}
                    className="text-sm font-medium tabular hover:text-primary hover:underline"
                  >
                    {row.number}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular">
                      {formatTZS(row.balance?.balance ?? 0)}
                    </span>
                    <span>·</span>
                    <span>due {formatDate(row.due_date)}</span>
                    {row.balance?.is_overdue ? (
                      <Badge variant="destructive">
                        {row.balance.days_overdue}d late
                      </Badge>
                    ) : (
                      <Badge variant="outline">upcoming</Badge>
                    )}
                    {last && (
                      <span className="text-muted-foreground">
                        · reminded {formatDate(last.slice(0, 10))}
                      </span>
                    )}
                  </p>
                </div>

                <ReminderButton
                  kind={kind}
                  customerName={group.customerName}
                  customerPhone={group.phone}
                  orgName={orgName}
                  language={language}
                  invoices={toRefs([row])}
                  invoiceIds={[row.id]}
                  label={last ? "Remind again" : "Remind"}
                  variant={last ? "outline" : "default"}
                />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
