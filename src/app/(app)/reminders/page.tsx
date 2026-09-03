import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { RemindersBody } from "./reminders-body";

export const metadata = { title: "Reminders" };

/** A static shell — see the note in RemindersBody for what moved and why. */
export default function RemindersPage() {
  return (
    <>
      <PageHeader
        title="Reminders"
        description="Everything past due, grouped by customer, ready to send on WhatsApp."
      />

      <Suspense>
        <RemindersBody />
      </Suspense>
    </>
  );
}
