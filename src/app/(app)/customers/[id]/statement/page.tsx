import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { buildStatement, defaultRange } from "@/lib/statement";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { AgeingBar } from "@/components/stat-tile";
import { StatementControls } from "./statement-controls";

export const metadata = { title: "Statement" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StatementPage(
  props: PageProps<"/customers/[id]/statement">,
) {
  const { id } = await props.params;
  const params = await props.searchParams;
  const session = await requireSession();

  const today = todayLocal();
  const fallback = defaultRange(today);
  const from =
    typeof params.from === "string" && DATE_RE.test(params.from)
      ? params.from
      : fallback.from;
  const to =
    typeof params.to === "string" && DATE_RE.test(params.to) ? params.to : fallback.to;

  const statement = await buildStatement(id, from, to);
  if (!statement) notFound();

  const { customer, lines, openingBalance, closingBalance, totalInvoiced, totalPaid, ageing } =
    statement;

  return (
    <>
      <Link
        href={`/customers/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        Back to {customer.name}
      </Link>

      <PageHeader
        className="print:hidden"
        title="Statement of account"
        description={`${customer.name} · ${formatDate(from)} to ${formatDate(to)}`}
      />

      <StatementControls customerId={id} from={from} to={to} today={today} />

      {/* Letterhead — only shows on paper, where there is no app chrome. */}
      <div className="mb-6 hidden print:block">
        <h1 className="text-lg font-bold">{session.org.legal_name || session.org.name}</h1>
        {session.org.tin && <p className="text-xs">TIN: {session.org.tin}</p>}
        <h2 className="mt-4 text-base font-semibold">Statement of Account</h2>
        <p className="text-sm">
          {customer.name}
          {customer.phone_e164 ? ` · ${displayPhone(customer.phone_e164)}` : ""}
        </p>
        <p className="text-sm">
          Period: {formatDate(from)} — {formatDate(to)}
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-4 print:grid-cols-4">
        <SummaryBox label="Opening balance" value={formatTZS(openingBalance)} />
        <SummaryBox label="Invoiced" value={formatTZS(totalInvoiced)} />
        <SummaryBox label="Paid" value={formatTZS(totalPaid)} tone="success" />
        <SummaryBox
          label="Closing balance"
          value={formatTZS(closingBalance)}
          tone={closingBalance > 0 ? "destructive" : "default"}
          emphasis
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-32">Reference</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell className="text-muted-foreground">{formatDate(from)}</TableCell>
              <TableCell />
              <TableCell className="font-medium">Balance brought forward</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right tabular font-medium">
                {formatMoney(openingBalance)}
              </TableCell>
            </TableRow>

            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No invoices or payments in this period.
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line, index) => (
                <TableRow key={`${line.kind}-${line.invoiceId}-${index}`}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(line.date)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/invoices/${line.invoiceId}`}
                      className="tabular font-medium hover:text-primary hover:underline print:no-underline"
                    >
                      {line.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.description}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {line.debit ? formatMoney(line.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular text-success">
                    {line.credit ? formatMoney(line.credit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular font-medium">
                    {formatMoney(line.balance)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Closing balance {formatDate(to)}
              </TableCell>
              <TableCell className="text-right tabular font-medium">
                {formatMoney(totalInvoiced)}
              </TableCell>
              <TableCell className="text-right tabular font-medium">
                {formatMoney(totalPaid)}
              </TableCell>
              <TableCell className="text-right tabular text-base font-bold">
                {formatMoney(closingBalance)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      {ageing && ageing.balance > 0 && (
        <Card className="mt-5">
          <CardContent className="pt-5">
            <p className="mb-3 text-sm font-medium">
              How old the outstanding balance is
            </p>
            <AgeingBar
              format={formatMoney}
              buckets={[
                { label: "Current", amount: ageing.bucket_current },
                { label: "1–30 days", amount: ageing.bucket_1_30 },
                { label: "31–60 days", amount: ageing.bucket_31_60 },
                { label: "61–90 days", amount: ageing.bucket_61_90 },
                { label: "90+ days", amount: ageing.bucket_90_plus },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {session.org.bank_details && (
        <div className="mt-6 hidden text-xs print:block">
          <p className="font-semibold">Payment details</p>
          <p className="whitespace-pre-line">{session.org.bank_details}</p>
        </div>
      )}
    </>
  );
}

function SummaryBox({
  label,
  value,
  tone = "default",
  emphasis,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "destructive";
  emphasis?: boolean;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
  }[tone];

  return (
    <div
      className={`rounded-xl border p-4 ${emphasis ? "border-foreground/20 bg-muted/40" : "border-border bg-card"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1.5 text-lg font-semibold tabular ${toneClass}`}>{value}</p>
    </div>
  );
}
