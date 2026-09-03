"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Phone } from "lucide-react";
import { addDays, formatDate, formatTZS, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { InvoiceRef } from "@/lib/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { useAll, useAppSession, useSync } from "@/lib/offline/local";
import {
  daysLate,
  paidByInvoice,
  round2,
  type MirrorPayment,
} from "@/lib/offline/derive";
import { ReminderButton } from "./reminder-dialog";
import type { Customer, Invoice } from "@/lib/types";

const DUE_SOON_WINDOW_DAYS = 7;

/** An invoice with the arithmetic this screen needs already done. */
type Row = {
  id: string;
  number: string;
  dueDate: string | null;
  balance: number;
  daysOverdue: number;
  isOverdue: boolean;
  customerId: string;
  customerName: string;
  phone: string | null;
};

type Group = {
  customerId: string;
  customerName: string;
  phone: string | null;
  rows: Row[];
  total: number;
  worstDays: number;
};

type Reminder = { id: string; invoice_id: string; sent_at: string };

function groupByCustomer(rows: Row[]): Group[] {
  const map = new Map<string, Group>();

  for (const row of rows) {
    const existing = map.get(row.customerId);
    if (existing) {
      existing.rows.push(row);
      existing.total = round2(existing.total + row.balance);
      existing.worstDays = Math.max(existing.worstDays, row.daysOverdue);
    } else {
      map.set(row.customerId, {
        customerId: row.customerId,
        customerName: row.customerName,
        phone: row.phone,
        rows: [row],
        total: row.balance,
        worstDays: row.daysOverdue,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.worstDays - a.worstDays || b.total - a.total);
}

function toRefs(rows: Row[]): InvoiceRef[] {
  return rows.map((r) => ({
    number: r.number,
    balance: r.balance,
    dueDate: r.dueDate,
    daysOverdue: r.daysOverdue,
  }));
}

/**
 * The chase list, assembled on this device.
 *
 * It used to be the most expensive screen in the app by a wide margin. To show
 * the twenty or so invoices worth chasing it asked the server for every issued
 * invoice ever raised — with a customer join, no date filter and no limit —
 * plus every row of invoice_balances and every reminder ever logged, and then
 * threw almost all of it away in JavaScript. The cost grew with the age of the
 * business rather than with the size of the answer, which is the wrong way
 * round for a screen somebody opens several times a day.
 *
 * All of it is already on the device, and the same arithmetic lives in
 * derive.ts, tested. So the queries are gone, and with them the last thing
 * forcing this route to render on demand — which is what made it hang on a
 * weak connection and fail outright on none.
 */
export function RemindersBody() {
  const today = todayLocal();
  const horizon = addDays(today, DUE_SOON_WINDOW_DAYS);

  const session = useAppSession();
  const syncState = useSync();
  const invoices = useAll<Invoice>("invoices");
  const customers = useAll<Customer>("customers");
  const payments = useAll<MirrorPayment>("payments");
  const reminders = useAll<Reminder>("reminders");

  const view = useMemo(() => {
    const byCustomer = new Map(customers.map((c) => [c.id, c]));
    const paid = paidByInvoice(payments);

    /*
     * The most recent reminder per invoice.
     *
     * Sorted here rather than relying on the store's order: IndexedDB returns
     * rows in key order, which is a uuid and therefore arbitrary. The old
     * version got this from an ORDER BY in the query.
     */
    const lastReminded = new Map<string, string>();
    for (const r of [...reminders].sort((a, b) =>
      String(b.sent_at).localeCompare(String(a.sent_at)),
    )) {
      if (!lastReminded.has(r.invoice_id)) lastReminded.set(r.invoice_id, r.sent_at);
    }

    const rows: Row[] = [];
    for (const invoice of invoices) {
      if (invoice.status !== "issued") continue;

      const balance = round2(Number(invoice.total) - (paid.get(invoice.id) ?? 0));
      if (balance <= 0) continue;

      const customer = byCustomer.get(invoice.customer_id);
      if (!customer) continue;

      const late = daysLate(invoice.due_date, today);
      rows.push({
        id: invoice.id,
        number: invoice.number ?? invoice.draft_ref,
        dueDate: invoice.due_date,
        balance,
        daysOverdue: late,
        isOverdue: late > 0,
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone_e164,
      });
    }

    const overdue = rows.filter((r) => r.isOverdue);
    const dueSoon = rows.filter(
      (r) =>
        !r.isOverdue &&
        r.dueDate !== null &&
        r.dueDate >= today &&
        r.dueDate <= horizon,
    );

    return {
      overdue,
      dueSoon,
      lastReminded,
      overdueGroups: groupByCustomer(overdue),
      dueSoonGroups: groupByCustomer(dueSoon),
      totalOverdue: round2(overdue.reduce((sum, r) => sum + r.balance, 0)),
      totalDueSoon: round2(dueSoon.reduce((sum, r) => sum + r.balance, 0)),
      oldest: overdue.reduce((max, r) => Math.max(max, r.daysOverdue), 0),
    };
  }, [invoices, customers, payments, reminders, today, horizon]);

  /*
   * "Nothing overdue" and "this device has not been told about your invoices
   * yet" look identical on screen and mean opposite things. Only say the
   * first once the mirror has actually been filled.
   */
  if (isColdEmpty(invoices.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const orgName = session?.orgName ?? "";
  const language = session?.reminderLanguage ?? "en";

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Overdue"
          value={formatTZS(view.totalOverdue)}
          tone={view.totalOverdue > 0 ? "destructive" : "default"}
          hint={`${view.overdue.length} invoices · ${view.overdueGroups.length} customers`}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Oldest debt"
          value={view.oldest > 0 ? `${view.oldest} days` : "—"}
          hint={view.oldest > 90 ? "Past 90 days — chase hard" : "Days past the due date"}
          icon={<Clock className="size-4" />}
        />
        <StatTile
          label={`Due within ${DUE_SOON_WINDOW_DAYS} days`}
          value={formatTZS(view.totalDueSoon)}
          hint={`${view.dueSoon.length} invoices — nudge before they slip`}
          icon={<CalendarClock className="size-4" />}
        />
      </div>

      <Tabs defaultValue="overdue">
        <TabsList>
          <TabsTrigger value="overdue">Overdue ({view.overdue.length})</TabsTrigger>
          <TabsTrigger value="due_soon">Due soon ({view.dueSoon.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overdue">
          {view.overdueGroups.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title="Nothing overdue"
              description="Every issued invoice is still inside its payment terms."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {view.overdueGroups.map((group) => (
                <CustomerGroup
                  key={group.customerId}
                  group={group}
                  kind="overdue"
                  orgName={orgName}
                  language={language}
                  lastReminded={view.lastReminded}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="due_soon">
          {view.dueSoonGroups.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nothing falling due this week"
              description={`Invoices due in the next ${DUE_SOON_WINDOW_DAYS} days appear here so you can nudge before they go late.`}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {view.dueSoonGroups.map((group) => (
                <CustomerGroup
                  key={group.customerId}
                  group={group}
                  kind="due_soon"
                  orgName={orgName}
                  language={language}
                  lastReminded={view.lastReminded}
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
                    <span className="tabular">{formatTZS(row.balance)}</span>
                    <span>·</span>
                    <span>due {formatDate(row.dueDate)}</span>
                    {row.isOverdue ? (
                      <Badge variant="destructive">{row.daysOverdue}d late</Badge>
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
