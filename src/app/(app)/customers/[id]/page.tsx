import { requireSession } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { CustomerDetail } from "./customer-detail";

/**
 * Auth only. Everything on this screen — the customer, their invoices, their
 * payments and the ageing of what they owe — is read from this device.
 */
export default async function CustomerDetailPage(
  props: PageProps<"/customers/[id]">,
) {
  const { id } = await props.params;
  const session = await requireSession();

  return (
    <CustomerDetail
      id={id}
      defaultTermsDays={session.org.default_terms_days}
      today={todayLocal()}
    />
  );
}
