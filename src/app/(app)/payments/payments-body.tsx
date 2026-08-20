"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Receipt, Wallet } from "lucide-react";
import { formatDate, formatMoney, formatTZS } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/page-header";
import { RowAction, RowLink, rowLink } from "@/components/row-link";
import { StatTile } from "@/components/stat-tile";
import { SearchInput } from "@/components/search-input";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { useAll, useSync } from "@/lib/offline/local";
import {
  daysLate,
  paidByInvoice,
  paymentState,
  round2,
  type MirrorPayment,
} from "@/lib/offline/derive";
import { CollectCard, CollectRow, type CollectItem } from "./collect-row";
import type { Customer, Invoice } from "@/lib/types";

type PaymentRow = {
  id: string;
  paid_on: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  invoice: {
    id: string;
    number: string | null;
    draft_ref: string;
    customer: { id: string; name: string } | null;
  } | null;
};

/**
 * The collections screen, assembled on this device.
 *
 * This is the one that most needed to work without a signal: it is the list
 * you work down while standing in front of customers, and recording a payment
 * here is exactly the thing that used to be invisible until the next sync.
 * Both halves now read the mirror, so a payment taken moves the invoice out of
 * the "awaiting payment" list immediately.
 */
export function PaymentsBody({ query, today }: { query: string; today: string }) {
  const syncState = useSync();
  const invoicesRaw = useAll<Invoice>("invoices");
  const customers = useAll<Customer>("customers");
  const paymentsRaw = useAll<MirrorPayment & PaymentRow>("payments");

  const month = today.slice(0, 7);

  const view = useMemo(() => {
    const names = new Map(customers.map((c) => [c.id, c]));
    const byInvoice = new Map(invoicesRaw.map((i) => [i.id, i]));
    const paidMap = paidByInvoice(paymentsRaw);
    const q = query.trim().toLowerCase();

    /*
     * Every issued invoice appears the moment it is raised, before a shilling
     * arrives: this is the "who owes me" list, not a log of money received.
     */
    let collect: CollectItem[] = invoicesRaw
      .filter((inv) => inv.status === "issued" && inv.doc_type === "invoice")
      .map((inv) => {
        const amountPaid = paidMap.get(inv.id) ?? 0;
        const balance = round2(Number(inv.total) - amountPaid);
        const customer = names.get(inv.customer_id);
        const late = balance > 0 ? daysLate(inv.due_date, today) : 0;

        return {
          id: inv.id,
          number: inv.number ?? inv.draft_ref,
          dueDate: inv.due_date,
          total: Number(inv.total),
          amountPaid,
          balance,
          paymentState: paymentState(Number(inv.total), amountPaid),
          isOverdue: late > 0,
          daysOverdue: late,
          customer: customer ? { id: customer.id, name: customer.name } : null,
        };
      })
      .filter((item) => item.balance > 0)
      // Oldest debt first — the order you actually work down.
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

    let payments: PaymentRow[] = [...paymentsRaw]
      .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)))
      .slice(0, 500)
      .map((p) => {
        const inv = byInvoice.get(p.invoice_id);
        const customer = inv ? names.get(inv.customer_id) : undefined;
        return {
          id: p.id,
          paid_on: p.paid_on,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference ?? null,
          invoice: inv
            ? {
                id: inv.id,
                number: inv.number,
                draft_ref: inv.draft_ref,
                customer: customer ? { id: customer.id, name: customer.name } : null,
              }
            : null,
        };
      });

    if (q) {
      collect = collect.filter(
        (item) =>
          item.number.toLowerCase().includes(q) ||
          (item.customer?.name ?? "").toLowerCase().includes(q),
      );
      payments = payments.filter(
        (p) =>
          (p.invoice?.number ?? "").toLowerCase().includes(q) ||
          (p.invoice?.customer?.name ?? "").toLowerCase().includes(q) ||
          (p.reference ?? "").toLowerCase().includes(q),
      );
    }

    return {
      collect,
      payments,
      outstanding: round2(collect.reduce((sum, i) => sum + i.balance, 0)),
      overdue: round2(
        collect.filter((i) => i.isOverdue).reduce((sum, i) => sum + i.balance, 0),
      ),
      receivedThisMonth: round2(
        payments
          .filter((p) => String(p.paid_on).startsWith(month))
          .reduce((sum, p) => sum + Number(p.amount), 0),
      ),
    };
  }, [invoicesRaw, customers, paymentsRaw, query, today, month]);

  if (isColdEmpty(invoicesRaw.length, syncState)) {
    return <FirstSync state={syncState} noun="invoices" />;
  }

  const { collect, payments, outstanding, overdue, receivedThisMonth } = view;
  const q = query.trim().toLowerCase();

  return (
    <>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Outstanding"
          value={formatTZS(outstanding)}
          hint={`${collect.length} invoices awaiting payment`}
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="Overdue"
          value={formatTZS(overdue)}
          tone={overdue > 0 ? "destructive" : "default"}
          hint={overdue > 0 ? "Past the agreed due date" : "Nothing past due"}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Received this month"
          value={formatTZS(receivedThisMonth)}
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
      </div>

      <div className="mb-4 max-w-md">
        <SearchInput placeholder="Invoice number, customer or reference…" />
      </div>

      <Tabs defaultValue="collect">
        <TabsList>
          <TabsTrigger value="collect">To collect ({collect.length})</TabsTrigger>
          <TabsTrigger value="received">Received ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="collect">
          {collect.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5" />}
              title={q ? "Nothing matches that search" : "Everything is paid"}
              description={
                q
                  ? "Try a different invoice number or customer."
                  : "Every issued invoice has been settled in full. Newly issued invoices appear here straight away."
              }
            />
          ) : (
            <>
              <Card className="hidden overflow-hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden sm:table-cell">Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden text-right md:table-cell">
                        Total
                      </TableHead>
                      <TableHead className="hidden text-right md:table-cell">
                        Paid
                      </TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-52 text-right">Record</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collect.map((item) => (
                      <CollectRow key={item.id} item={item} />
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <div className="flex flex-col gap-2.5 lg:hidden">
                {collect.map((item) => (
                  <CollectCard key={item.id} item={item} />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="received">
          {payments.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-5" />}
              title={q ? "No payments match that search" : "No payments recorded yet"}
              description="Use the Full paid or Partial buttons on the To collect tab."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="hidden md:table-cell">Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-20 text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow
                      key={p.id}
                      className={p.invoice ? rowLink : undefined}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(p.paid_on)}
                      </TableCell>
                      <TableCell>
                        {p.invoice ? (
                          <RowLink
                            href={`/invoices/${p.invoice.id}`}
                            className="tabular"
                          >
                            {p.invoice.number ?? p.invoice.draft_ref}
                          </RowLink>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {p.invoice?.customer ? (
                          <RowAction>
                            <Link
                              href={`/customers/${p.invoice.customer.id}`}
                              className="hover:text-primary hover:underline"
                            >
                              {p.invoice.customer.name}
                            </Link>
                          </RowAction>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {PAYMENT_METHOD_LABELS[p.method]}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {p.reference ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular font-medium text-success">
                        {formatMoney(p.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowAction>
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link
                              href={`/payments/${p.id}/receipt`}
                              target="_blank"
                              aria-label="Print receipt"
                            >
                              <Receipt className="size-4" />
                            </Link>
                          </Button>
                        </RowAction>
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
