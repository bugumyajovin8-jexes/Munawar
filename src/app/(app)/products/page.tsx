import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { ProductsHeaderAction, ProductsList } from "./products-list";

export const metadata = { title: "Products" };

/** A static shell — see the note in /invoices/page.tsx. */
export default function ProductsPage() {
  return (
    <>
      <PageHeader
        title="Products"
        description="The things you sell, saved on this device."
        actions={
          <Suspense>
            <ProductsHeaderAction />
          </Suspense>
        }
      />

      <Suspense>
        <ProductsList />
      </Suspense>
    </>
  );
}
