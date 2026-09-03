"use client";

import Link from "next/link";
import { ChevronRight, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { SearchInput } from "@/components/search-input";
import { RowLink, rowLink } from "@/components/row-link";
import { formatMoney, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { useAll, useAppSession, useSync } from "@/lib/offline/local";
import { customerBalances } from "@/lib/offline/derive";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { CustomerDialog } from "./customer-dialog";
import type { Customer } from "@/lib/types";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

type MirrorInvoice = Parameters<typeof customerBalances>[0][number];
type MirrorPayment = Parameters<typeof customerBalances>[1][number];

/**
 * The customer list, read from this device rather than the server.
 *
 * Two things follow from that. A customer added with no signal is here the
 * moment the dialog closes, instead of after the next sync — and moving to
 * this screen costs an IndexedDB read rather than a round trip to Supabase, so
 * it paints immediately whether or not there is a connection.
 *
 * Balances are computed here too, because customer_balances is a SQL view and
 * SQL is exactly what a device in a shop with no signal does not have.
 *
 * The server's own rows are still passed in and still used until the mirror
 * has been filled: on a first-ever load there is nothing local to read, and an
 * empty list would be a lie rather than an answer.
 */
/** The "New customer" button, which needs the org's default payment terms. */
export function CustomersHeaderAction() {
  const session = useAppSession();

  return (
    <CustomerDialog
      defaultTermsDays={session?.defaultTermsDays ?? 30}
      trigger={
        <Button>
          <Plus className="size-4" />
          New customer
        </Button>
      }
    />
  );
}

export function CustomersList() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const session = useAppSession();
  const defaultTermsDays = session?.defaultTermsDays ?? 30;
  const today = todayLocal();
  const syncState = useSync();
  const mirrorCustomers = useAll<Customer>("customers");
  const invoices = useAll<MirrorInvoice>("invoices");
  const payments = useAll<MirrorPayment>("payments");

  const list = useMemo(() => {
    const source = mirrorCustomers;

    // Searching runs against the mirror as well, so the box keeps working with
    // no connection instead of quietly returning whatever the server last saw.
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? source.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.phone_e164 ?? "").toLowerCase().includes(needle),
        )
      : source;

    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [mirrorCustomers, query]);

  const balances = useMemo(
    () => customerBalances(invoices, payments, today),
    [invoices, payments, today],
  );

  const q = query;

  /*
   * An empty list is ambiguous now that it comes from the device: it can mean
   * "no customers" or "not downloaded yet". Only say the first when the mirror
   * has actually been filled.
   */
  if (isColdEmpty(mirrorCustomers.length, syncState)) {
    return <FirstSync state={syncState} noun="customers" />;
  }

  return (
    <>
      <div className="mb-4 max-w-md">
        <SearchInput placeholder="Search by name or phone…" />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={q ? "No customers match that search" : "No customers yet"}
          description={
            q
              ? "Try a different name or phone number."
              : "Add your first customer and you can start invoicing them straight away."
          }
          action={
            !q ? (
              <CustomerDialog
                defaultTermsDays={defaultTermsDays}
                trigger={
                  <Button>
                    <Plus className="size-4" />
                    New customer
                  </Button>
                }
              />
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop: the dense table view is the primary layout. */}
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Terms</TableHead>
                  <TableHead className="text-right">Owes you</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => {
                  const b = balances.get(c.id);
                  return (
                    <TableRow key={c.id} className={rowLink}>
                      <TableCell>
                        <RowLink href={`/customers/${c.id}`}>{c.name}</RowLink>
                        {!c.is_active && (
                          <Badge variant="muted" className="ml-2">
                            Inactive
                          </Badge>
                        )}
                        {c.contact_person && (
                          <p className="text-xs text-muted-foreground">
                            {c.contact_person}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {displayPhone(c.phone_e164)}
                      </TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">
                        {c.payment_terms_days}d
                      </TableCell>
                      <TableCell className="text-right tabular font-medium">
                        {formatMoney(b?.balance ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {b && b.overdue > 0 ? (
                          <span className="font-medium text-destructive">
                            {formatMoney(b.overdue)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* Affordance only — the whole row is the link now. */}
                      <TableCell aria-hidden>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Phone: cards, because a five-column table is unreadable at 375px. */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {list.map((c) => {
              const b = balances.get(c.id);
              return (
                <Link key={c.id} href={`/customers/${c.id}`} className="block">
                  <Card className="p-4 transition-colors active:bg-accent">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {displayPhone(c.phone_e164)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular font-medium">
                          {formatMoney(b?.balance ?? 0)}
                        </p>
                        {b && b.overdue > 0 && (
                          <p className="tabular text-xs font-medium text-destructive">
                            {formatMoney(b.overdue)} overdue
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
