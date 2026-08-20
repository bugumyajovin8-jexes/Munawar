import Link from "next/link";
import { CalendarSync, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { FREQUENCY_LABELS } from "@/lib/types";
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
import { EmptyState, PageHeader } from "@/components/page-header";
import { RowAction, RowLink, rowLink } from "@/components/row-link";
import { RecurringRowActions } from "./recurring-actions";
import type { RecurringInvoice, RecurringItem } from "@/lib/types";

export const metadata = { title: "Recurring invoices" };

type Row = RecurringInvoice & { customer: { id: string; name: string } | null };

export default async function RecurringPage() {
  await requireSession();
  const supabase = await createClient();
  const today = todayLocal();

  const { data } = await supabase
    .from("recurring_invoices")
    .select("*, customer:customers(id, name)")
    .order("next_run_on");

  const schedules = (data ?? []) as unknown as Row[];

  const { data: itemRows } = schedules.length
    ? await supabase
        .from("recurring_invoice_items")
        .select("recurring_id, qty, unit_price")
        .in(
          "recurring_id",
          schedules.map((s) => s.id),
        )
    : { data: [] };

  // Indicative value per run — VAT excluded, it's a rough "what does this bill".
  const valueBySchedule = new Map<string, number>();
  for (const item of (itemRows ?? []) as Pick<RecurringItem, "qty" | "unit_price">[] &
    { recurring_id: string }[]) {
    const key = item.recurring_id;
    valueBySchedule.set(
      key,
      (valueBySchedule.get(key) ?? 0) + Number(item.qty) * Number(item.unit_price),
    );
  }

  const active = schedules.filter((s) => s.is_active);

  return (
    <>
      <PageHeader
        title="Recurring invoices"
        description="Templates that raise themselves on schedule, so a monthly customer never gets forgotten."
        actions={
          <Button asChild>
            <Link href="/recurring/new">
              <Plus className="size-4" />
              New schedule
            </Link>
          </Button>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarSync className="size-5" />}
          title="No recurring invoices yet"
          description="Set one up for any customer you bill on a regular cycle. It generates a draft — or issues it outright — without you remembering."
          action={
            <Button asChild>
              <Link href="/recurring/new">
                <Plus className="size-4" />
                New schedule
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {active.length} active · next run{" "}
            {active.length > 0 ? formatDate(active[0].next_run_on) : "—"}
          </p>

          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id} className={rowLink}>
                    <TableCell>
                      <RowLink href={`/recurring/${s.id}`}>{s.name}</RowLink>
                      {!s.is_active && (
                        <Badge variant="muted" className="ml-2">
                          Paused
                        </Badge>
                      )}
                      {s.generated_count > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {s.generated_count} raised so far
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.customer ? (
                        <RowAction>
                          <Link
                            href={`/customers/${s.customer.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {s.customer.name}
                          </Link>
                        </RowAction>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.interval_count > 1
                        ? `Every ${s.interval_count} ${s.frequency === "weekly" ? "weeks" : s.frequency === "yearly" ? "years" : s.frequency === "quarterly" ? "quarters" : "months"}`
                        : FREQUENCY_LABELS[s.frequency]}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          s.is_active && s.next_run_on <= today
                            ? "font-medium text-primary"
                            : "text-muted-foreground"
                        }
                      >
                        {s.is_active ? formatDate(s.next_run_on) : "—"}
                      </span>
                      {s.end_on && (
                        <p className="text-xs text-muted-foreground">
                          until {formatDate(s.end_on)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(valueBySchedule.get(s.id) ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.auto_issue ? "default" : "outline"}>
                        {s.auto_issue ? "Auto-issue" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RowAction>
                        <RecurringRowActions
                          id={s.id}
                          name={s.name}
                          isActive={s.is_active}
                        />
                      </RowAction>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-2.5 lg:hidden">
            {schedules.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/recurring/${s.id}`} className="block truncate font-medium">
                      {s.name}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {s.customer?.name ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {FREQUENCY_LABELS[s.frequency]} ·{" "}
                      {s.is_active ? `next ${formatDate(s.next_run_on)}` : "paused"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular font-medium">
                      {formatMoney(valueBySchedule.get(s.id) ?? 0)}
                    </span>
                    <RecurringRowActions id={s.id} name={s.name} isActive={s.is_active} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
