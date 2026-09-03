import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/format";
import { PAYMENT_STATE_LABELS } from "@/lib/types";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StatementLine } from "@/lib/statement";

/**
 * One running ledger, drawn.
 *
 * Extracted from the statement page when branches arrived, for the same reason
 * the arithmetic behind it was: the whole-account statement and each branch's
 * section have to look identical, down to the columns that are dropped on
 * paper and the two different column spans that go with that. A second copy of
 * this table would be a second place for the print layout to be almost right.
 *
 * A plain server component — nothing here is interactive.
 */
export function StatementLedger({
  from,
  to,
  openingBalance,
  lines,
  closingBalance,
  totalInvoiced,
  totalPaid,
  heading,
}: {
  from: string;
  to: string;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  /** A branch name, when this ledger is one section of several. */
  heading?: string;
}) {
  return (
    <Card className="overflow-hidden">
      {heading && (
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">{heading}</p>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Date</TableHead>
            <TableHead className="w-32">Reference</TableHead>
            {/*
              Dropped on paper.

              Seven columns do not fit across A4, and this is much the widest
              — so it was the one pushing Status and Balance off the edge.
              Every other column carries a figure or a date that cannot be
              inferred from anything else; a description can be.
            */}
            <TableHead className="print:hidden">Description</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40">
            <TableCell className="text-muted-foreground">{formatDate(from)}</TableCell>
            {/* The label lives in Description on screen and moves into the
                Reference column on paper, where that column is gone. */}
            <TableCell className="font-medium">
              <span className="hidden print:inline">Balance brought forward</span>
            </TableCell>
            <TableCell className="font-medium print:hidden">
              Balance brought forward
            </TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell className="text-right tabular font-medium">
              {formatMoney(openingBalance)}
            </TableCell>
          </TableRow>

          {lines.length === 0 ? (
            <TableRow>
              {/* One column fewer on paper, so the span has to differ too. */}
              <TableCell
                colSpan={7}
                className="py-10 text-center text-muted-foreground print:hidden"
              >
                No invoices or payments in this period.
              </TableCell>
              <TableCell
                colSpan={6}
                className="hidden py-10 text-center text-muted-foreground print:table-cell"
              >
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
                <TableCell className="text-muted-foreground print:hidden">
                  {line.description}
                </TableCell>
                {/*
                  Blank on payments and credit notes. A payment is not itself
                  paid, and a credit note reduces a debt rather than carrying
                  one — "Not paid" on either would read as money still owed.
                */}
                <TableCell className="whitespace-nowrap">
                  {line.status ? (
                    <span
                      className={
                        line.status.state === "paid"
                          ? "text-success"
                          : line.status.state === "partial"
                            ? "text-warning"
                            : "text-muted-foreground"
                      }
                    >
                      {PAYMENT_STATE_LABELS[line.status.state]}
                      {line.status.remaining > 0 &&
                        ` · ${formatMoney(line.status.remaining)}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
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
            {/* Spans the status column too — a closing balance is a total,
                not an invoice, so it has no payment state of its own. One
                column narrower on paper, where Description is dropped. */}
            <TableCell colSpan={4} className="font-semibold print:hidden">
              {heading ? `Closing balance — ${heading}` : `Closing balance ${formatDate(to)}`}
            </TableCell>
            <TableCell colSpan={3} className="hidden font-semibold print:table-cell">
              {heading ? `Closing balance — ${heading}` : `Closing balance ${formatDate(to)}`}
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
  );
}
