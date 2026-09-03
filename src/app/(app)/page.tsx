import { DashboardBody } from "./dashboard-body";

export const metadata = { title: "Dashboard" };

/**
 * A static shell. Even the greeting is rendered on the device — reading the
 * session here would make this route dynamic, and this is the screen people
 * open most, so it is the one that most needs to be prefetchable.
 */
export default function DashboardPage() {
  return <DashboardBody />;
}
