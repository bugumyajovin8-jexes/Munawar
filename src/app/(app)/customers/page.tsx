import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { sanitiseQuery } from "@/lib/search";
import { CustomerDialog } from "./customer-dialog";
import { CustomersList } from "./customers-list";

export const metadata = { title: "Customers" };

/**
 * Auth and layout only — no data.
 *
 * The list is read from this device's mirror by the client component below,
 * which is what makes moving to this screen instant instead of a round trip to
 * Vercel and then Supabase. Fetching here as well would put that round trip
 * back on every navigation, which is precisely the thing being removed.
 */
export default async function CustomersPage(props: PageProps<"/customers">) {
  const session = await requireSession();
  const params = await props.searchParams;
  const q = sanitiseQuery(typeof params.q === "string" ? params.q : undefined);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone you invoice, saved on this device."
        actions={
          <CustomerDialog
            defaultTermsDays={session.org.default_terms_days}
            trigger={
              <Button>
                <Plus className="size-4" />
                New customer
              </Button>
            }
          />
        }
      />

      <div className="mb-4 max-w-md">
        <SearchInput placeholder="Search by name or phone…" />
      </div>

      <CustomersList
        query={q ?? ""}
        defaultTermsDays={session.org.default_terms_days}
        today={todayLocal()}
      />
    </>
  );
}
