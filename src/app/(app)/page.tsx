import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDate, todayLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { DashboardBody } from "./dashboard-body";

export const metadata = { title: "Dashboard" };

/**
 * Auth and greeting only.
 *
 * Every figure below is worked out on the device from the mirror. This was the
 * slowest screen in the app and the one people open most — four queries and
 * two SQL views on every visit — and it is now arithmetic over rows already on
 * the phone.
 */
export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title={`Habari, ${session.fullName?.split(" ")[0] ?? "there"}`}
        description={`${session.org.name} · ${formatDate(todayLocal())}`}
        actions={
          <Button asChild>
            <Link href="/invoices/new">
              <Plus className="size-4" />
              New invoice
            </Link>
          </Button>
        }
      />

      <DashboardBody isAdmin={session.role === "admin"} today={todayLocal()} />
    </>
  );
}
