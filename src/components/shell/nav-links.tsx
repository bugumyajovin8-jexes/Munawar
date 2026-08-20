"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive, type NavItem } from "@/lib/nav";
import { usePrefetchOnIntent } from "@/lib/prefetch";
import type { UserRole } from "@/lib/types";

export function NavLinks({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const prefetch = usePrefetchOnIntent();
  const items = NAV_ITEMS.filter((i: NavItem) => !i.adminOnly || role === "admin");

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            onMouseEnter={() => prefetch.onPointerEnter(item.href)}
            onMouseLeave={prefetch.onPointerLeave}
            onFocus={() => prefetch.onPointerEnter(item.href)}
            onTouchStart={() => prefetch.onTouchStart(item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
