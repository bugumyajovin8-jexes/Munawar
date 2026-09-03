"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Wallet,
} from "lucide-react";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import {
  PAYMENT_METHOD_LABELS,
  type CustomerBranch,
  type PaymentMethod,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StatTile, AgeingBar } from "@/components/stat-tile";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { RowLink, rowLink } from "@/components/row-link";
import { FirstSync } from "@/components/offline/first-sync";
import { useAll, useAppSession, useOne, useRelated, useSync } from "@/lib/offline/local";
import { BranchDialog } from "../branch-dialog";
import {
  ageing,
  daysLate,
  paidByInvoice,
  paymentState,
  round2,
  type MirrorPayment,
} from "@/lib/offline/derive";
import { CustomerDialog } from "../customer-dialog";
import type { Customer, Invoice, Payment } from "@/lib/types";

/**
 * One customer, read from this device.
 *
 * The whole page is client-rendered rather than just its figures, because the
 * heading is the customer's own name — leaving that on the server would keep a
 * round trip on the very navigation this is meant to make instant.
 *
 * "Not found" needs care here in a way it did not on the server. A missing row
 * can mean the customer does not exist or that this device has not downloaded
 * them yet, and those must not look alike: telling someone their customer is
 * gone because a sync has not finished would be alarming and wrong.
 */
export function CustomerDetail() {
  const routeParams = useParams<{ id: string }>();
  const id = routeParams?.id ?? "";
  const session = useAppSession();
  const defaultTermsDays = session?.defaultTermsDays ?? 30;
  const today = todayLocal();
  const syncState = useSync();
  const customer = useOne<Customer>("customers", id);
  const allInvoices = useAll<Invoice>("invoices");
  const allPayments = useAll<MirrorPayment & Payment>("payments");

  const branches = useRelated<CustomerBranch>("customerBranches", "customer_id", id);
  const activeBranches = useMemo(
    () => branches.filter((b) => b.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  const view = useMemo(() => {
    const invoices = allInvoices
      .filter((i) => i.customer_id === id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const ids = new Set(invoices.map((i) => i.id));
    const payments = allPayments
      .filter((p) => ids.has(p.invoice_id))
      .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)));

    const paidMap = paidByInvoice(payments);
    const buckets = ageing(invoices, payments, today);
    const balance = round2(
      buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus,
    );

    return {
      invoices,
      payments,
      paidMap,
      buckets,
      balance,
      invoiceLabel: new Map(invoices.map((i) => [i.id, i.number ?? i.draft_ref])),
    };
  }, [allInvoices, allPayments, id, today]);

  if (!customer) {
    return <FirstSync state={syncState} noun="customer" />;
  }

  const { invoices, payments, paidMap, buckets, balance, invoiceLabel } = view;
  const cb = {
    balance,
    overdue_count: buckets.overdueCount,
    // Everything past its due date, which is every bucket except "current".
    overdue_amount: round2(
      buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus,
    ),
    bucket_current: buckets.current,
    bucket_1_30: buckets.d1_30,
    bucket_31_60: buckets.d31_60,
    bucket_61_90: buckets.d61_90,
    bucket_90_plus: buckets.d90plus,
  };
  const balances = new Map(
    invoices.map((i) => {
      const paid = paidMap.get(i.id) ?? 0;
      const bal = round2(Number(i.total) - paid);
      const late = i.status === "issued" && bal > 0 ? daysLate(i.due_date, today) : 0;
      return [
        i.id,
        {
          balance: bal,
          amount_paid: paid,
          payment_state: paymentState(Number(i.total), paid),
          is_overdue: late > 0,
          days_overdue: late,
        },
      ];
    }),
  );
  const overCreditLimit =
    customer.credit_limit > 0 && cb.balance > customer.credit_limit;

  return (
    <>
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All customers
      </Link>

      <PageHeader
        title={customer.name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {customer.phone_e164 && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {displayPhone(customer.phone_e164)}
              </span>
            )}
            {customer.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                {customer.email}
              </span>
            )}
            {customer.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {customer.city}
              </span>
            )}
            <Badge variant="outline">{customer.payment_terms_days}-day terms</Badge>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/customers/${customer.id}/statement`}>
                <FileSpreadsheet className="size-4" />
                Statement
              </Link>
            </Button>
            <CustomerDialog
              customer={customer}
              defaultTermsDays={defaultTermsDays}
              trigger={
                <Button variant="outline">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              }
            />
            <Button asChild>
              <Link href={`/invoices/new?customer=${customer.id}`}>
                <Plus className="size-4" />
                New invoice
              </Link>
            </Button>
          </>
        }
      />

      {overCreditLimit && (
        <Card className="mb-5 border-warning/40 bg-warning/10">
          <CardContent className="flex items-start gap-3 pt-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-foreground dark:text-warning" />
            <div className="text-sm">
              <p className="font-medium">Over their credit limit</p>
              <p className="text-muted-foreground">
                Outstanding {formatTZS(cb?.balance ?? 0)} against a limit of{" "}
                {formatTZS(customer.credit_limit)}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Owes you"
          value={formatTZS(cb?.balance ?? 0)}
          icon={<Wallet className="size-4" />}
        />
        <StatTile
          label="Overdue"
          value={formatTZS(cb?.overdue_amount ?? 0)}
          tone={(cb?.overdue_amount ?? 0) > 0 ? "destructive" : "default"}
          hint={
            cb?.overdue_count
              ? `${cb.overdue_count} invoice${cb.overdue_count === 1 ? "" : "s"} past due`
              : "Nothing past due"
          }
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Invoices"
          value={invoices.filter((i) => i.status === "issued").length}
          hint={`${invoices.filter((i) => i.status === "draft").length} draft`}
          icon={<FileText className="size-4" />}
        />
      </div>

      {cb && cb.balance > 0 && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Ageing</CardTitle>
          </CardHeader>
          <CardContent>
            <AgeingBar
              format={formatMoney}
              buckets={[
                { label: "Current", amount: cb.bucket_current },
                { label: "1–30 days", amount: cb.bucket_1_30 },
                { label: "31–60 days", amount: cb.bucket_31_60 },
                { label: "61–90 days", amount: cb.bucket_61_90 },
                { label: "90+ days", amount: cb.bucket_90_plus },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/*
        Offered on every customer, listed only once there is one. A business
        that invoices one address per customer should never have to think about
        branches — the same rule the discount word follows.
      */}
      <Card className="mb-5">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>
            Branches{activeBranches.length > 0 && ` (${activeBranches.length})`}
          </CardTitle>
          <BranchDialog
            customerId={id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" />
                Add branch
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          {activeBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. Add one for each place you invoice separately — the branch is
              printed on their invoices and gets its own section on their statement.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {activeBranches.map((branch) => (
                <li
                  key={branch.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{branch.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        branch.city,
                        branch.contact_person,
                        branch.phone_e164 ? displayPhone(branch.phone_e164) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No address on file"}
                    </p>
                  </div>
                  <BranchDialog
                    customerId={id}
                    branch={branch}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          {invoices.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-5" />}
              title="No invoices yet"
              action={
                <Button asChild>
                  <Link href={`/invoices/new?customer=${customer.id}`}>
                    <Plus className="size-4" />
                    Create the first one
                  </Link>
                </Button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="hidden md:table-cell">Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const b = balances.get(inv.id);
                    return (
                      <TableRow key={inv.id} className={rowLink}>
                        <TableCell>
                          <RowLink href={`/invoices/${inv.id}`} className="tabular">
                            {inv.number ?? inv.draft_ref}
                          </RowLink>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {formatDate(inv.invoice_date ?? inv.order_date)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {formatDate(inv.due_date)}
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge
                            status={inv.status}
                            paymentState={b?.payment_state}
                            isOverdue={b?.is_overdue}
                            daysOverdue={b?.days_overdue}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatMoney(inv.total)}
                        </TableCell>
                        <TableCell className="text-right tabular font-medium">
                          {formatMoney(b?.balance ?? inv.total)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="payments">
          {payments.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-5" />}
              title="No payments recorded"
              description="Payments appear here once you record them against an invoice."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="hidden md:table-cell">Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id} className={rowLink}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(p.paid_on)}
                      </TableCell>
                      <TableCell>
                        <RowLink
                          href={`/invoices/${p.invoice_id}`}
                          className="tabular"
                        >
                          {invoiceLabel.get(p.invoice_id) ?? "—"}
                        </RowLink>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {p.reference ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular font-medium text-success">
                        {formatMoney(p.amount)}
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
