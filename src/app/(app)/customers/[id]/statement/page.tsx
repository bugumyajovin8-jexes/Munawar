import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { buildStatement, defaultRange, HEAD_OFFICE } from "@/lib/statement";
import { formatDate, formatMoney, formatTZS, todayLocal } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AgeingBar } from "@/components/stat-tile";
import { StatementControls } from "./statement-controls";
import { StatementLedger } from "./statement-ledger";

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

  /*
   * A branch id, HEAD_OFFICE, or nothing at all for the whole account. Passed
   * straight through — buildStatement validates it by simply not matching an
   * id that does not exist, which yields an empty statement rather than an
   * error page.
   */
  const branchFilter = typeof params.branch === "string" && params.branch ? params.branch : null;

  const statement = await buildStatement(id, from, to, branchFilter);
  if (!statement) notFound();

  const {
    customer,
    lines,
    openingBalance,
    closingBalance,
    totalInvoiced,
    totalPaid,
    ageing,
    groups,
    branches,
  } = statement;

  const selectedBranch =
    branchFilter === HEAD_OFFICE
      ? "Head office"
      : (branches.find((b) => b.id === branchFilter)?.name ?? null);

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
        description={`${customer.name}${selectedBranch ? ` · ${selectedBranch}` : ""} · ${formatDate(from)} to ${formatDate(to)}`}
      />

      <StatementControls
        customerId={id}
        from={from}
        to={to}
        today={today}
        branches={branches}
        branchFilter={branchFilter}
      />

      {/* Letterhead — only shows on paper, where there is no app chrome. */}
      <div className="mb-6 hidden print:block">
        <h1 className="text-lg font-bold">{session.org.legal_name || session.org.name}</h1>
        {session.org.tin && <p className="text-xs">TIN: {session.org.tin}</p>}
        <h2 className="mt-4 text-base font-semibold">Statement of Account</h2>
        <p className="text-sm">
          {customer.name}
          {customer.phone_e164 ? ` · ${displayPhone(customer.phone_e164)}` : ""}
        </p>
        {selectedBranch && <p className="text-sm font-medium">{selectedBranch}</p>}
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

      {/*
        Sections when this customer is invoiced through branches, one ledger
        when they are not.

        A statement is a running balance rather than a list, so branches cannot
        simply be sorted together — the balance column would stop meaning
        anything. Each branch gets a ledger of its own instead, with its own
        opening and closing balance, and the closings add up to the figure in
        the summary above because every one of them is built by the same
        function from a partition of the same rows.
      */}
      {groups.length > 0 ? (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <StatementLedger
              key={group.branchId ?? "head-office"}
              from={from}
              to={to}
              heading={group.branchName}
              openingBalance={group.openingBalance}
              lines={group.lines}
              closingBalance={group.closingBalance}
              totalInvoiced={group.totalInvoiced}
              totalPaid={group.totalPaid}
            />
          ))}

          <div className="flex items-center justify-between rounded-xl border border-foreground/20 bg-muted/40 px-4 py-3">
            <p className="text-sm font-semibold">
              Closing balance, all branches · {formatDate(to)}
            </p>
            <p className="tabular text-lg font-bold">{formatTZS(closingBalance)}</p>
          </div>
        </div>
      ) : (
        <StatementLedger
          from={from}
          to={to}
          openingBalance={openingBalance}
          lines={lines}
          closingBalance={closingBalance}
          totalInvoiced={totalInvoiced}
          totalPaid={totalPaid}
        />
      )}

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
