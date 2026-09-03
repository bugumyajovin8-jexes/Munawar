import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { CustomersHeaderAction, CustomersList } from "./customers-list";

export const metadata = { title: "Customers" };

/** A static shell — see the note in /invoices/page.tsx. */
export default function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you invoice, saved on this device."
        actions={
          <Suspense>
            <CustomersHeaderAction />
          </Suspense>
        }
      />

      <Suspense>
        <CustomersList />
      </Suspense>
    </>
  );
}
