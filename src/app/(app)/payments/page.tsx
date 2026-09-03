import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { PaymentsBody } from "./payments-body";

export const metadata = { title: "Payments" };

/** A static shell — see the note in /invoices/page.tsx. */
export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        title="Payments"
        description="Every unpaid invoice, oldest first. Record what comes in without leaving the page."
      />

      <Suspense>
        <PaymentsBody />
      </Suspense>
    </>
  );
}
