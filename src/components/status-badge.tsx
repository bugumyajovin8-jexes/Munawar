import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus, PaymentState } from "@/lib/types";

/**
 * One place that decides how a document's state looks, so "overdue" is the
 * same red in the list, on the customer page and in the reminder queue.
 */
export function InvoiceStatusBadge({
  status,
  paymentState,
  isOverdue,
  daysOverdue,
}: {
  status: InvoiceStatus;
  paymentState?: PaymentState | null;
  isOverdue?: boolean | null;
  daysOverdue?: number | null;
}) {
  if (status === "draft") return <Badge variant="muted">Draft</Badge>;
  if (status === "void") return <Badge variant="muted">Void</Badge>;

  if (isOverdue) {
    return (
      <Badge variant="destructive">
        Overdue{daysOverdue ? ` · ${daysOverdue}d` : ""}
      </Badge>
    );
  }

  switch (paymentState) {
    case "paid":
      return <Badge variant="success">Paid</Badge>;
    case "partial":
      return <Badge variant="warning">Part-paid</Badge>;
    default:
      return <Badge variant="outline">Unpaid</Badge>;
  }
}
