import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Wallet,
  BellRing,
  BarChart3,
  CalendarSync,
  Settings,
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
  { href: "/recurring", label: "Recurring", icon: CalendarSync },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
