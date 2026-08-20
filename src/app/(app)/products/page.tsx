import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { sanitiseQuery } from "@/lib/search";
import { ProductDialog } from "./product-dialog";
import { ProductsList } from "./products-list";

export const metadata = { title: "Products" };

/**
 * Auth and layout only. The list comes from this device's mirror, so moving
 * here costs an IndexedDB read rather than a round trip to Supabase.
 */
export default async function ProductsPage(props: PageProps<"/products">) {
  const session = await requireSession();
  const params = await props.searchParams;
  const q = sanitiseQuery(typeof params.q === "string" ? params.q : undefined);
  const isAdmin = session.role === "admin";

  return (
    <>
      <PageHeader
        title="Products"
        description={
          isAdmin
            ? "Selling and buying prices. Stock is not tracked."
            : "Selling prices for the items you can invoice."
        }
        actions={
          isAdmin ? (
            <ProductDialog
              trigger={
                <Button>
                  <Plus className="size-4" />
                  New product
                </Button>
              }
            />
          ) : undefined
        }
      />

      <div className="mb-4 max-w-md">
        <SearchInput placeholder="Search by name or SKU…" />
      </div>

      <ProductsList query={q ?? ""} isAdmin={isAdmin} />
    </>
  );
}
