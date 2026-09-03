import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Wallet,
  BellRing,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export type NavHref =
  | "/"
  | "/invoices"
  | "/customers"
  | "/products"
  | "/payments"
  | "/reminders"
  | "/recurring"
  | "/reports"
  | "/settings";

export type NavItem = {
  href: NavHref;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  adminOnly?: boolean;
  /** Shown in the phone tab bar — there is room for five. */
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, primary: true },
  { href: "/invoices", label: "Invoices", icon: FileText, primary: true },
  { href: "/customers", label: "Customers", icon: Users, primary: true },
  // Chasing payment is a phone job, so it earns a tab-bar slot ahead of
  // Products, which is mostly set up once from a desk.
  { href: "/reminders", label: "Reminders", icon: BellRing, primary: true },
  { href: "/payments", label: "Payments", icon: Wallet, primary: true },
  { href: "/products", label: "Products", icon: Package },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  /*
   * Recurring and Settings are deliberately not here.
   *
   * Both are set-up-once screens rather than daily work, and a sidebar that
   * lists everything equally makes the things used every hour harder to find.
   * They live in the account menu at the bottom instead, which is where people
   * already go looking for configuration.
   *
   * NavHref still names them, and isActive() still works for them, so a link
   * from anywhere else in the app is unaffected.
   */
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
