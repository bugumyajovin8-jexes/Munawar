import { Suspense } from "react";
import { CustomerDetail } from "./customer-detail";

/**
 * A static shell for any customer.
 *
 * The id is read from the URL on the client rather than from `params` here,
 * because touching `params` would make this render on demand — and then every
 * tap through from the customer list would be a round trip again. One shell
 * serves every customer; which one it shows is decided on the device, from
 * data the device already has.
 */
export default function CustomerDetailPage() {
  return (
    <Suspense>
      <CustomerDetail />
    </Suspense>
  );
}
