import { requireSession } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PaymentsBody } from "./payments-body";

export const metadata = { title: "Payments" };

/**
 * Auth and layout only — the list you work down in front of customers is read
 * from this device, so it is there with no signal and a payment recorded on it
 * shows immediately.
 */
export default async function PaymentsPage(props: PageProps<"/payments">) {
  await requireSession();
  const params = await props.searchParams;
  const q = typeof params.q === "string" ? params.q : "";

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every unpaid invoice, oldest first. Record what comes in without leaving the page."
      />

      <PaymentsBody query={q} today={todayLocal()} />
    </>
  );
}
