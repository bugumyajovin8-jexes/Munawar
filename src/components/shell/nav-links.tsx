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
            /*
              The page you are on is marked in the logo's gold: the label, the
              icon, and a bar at the leading edge of the pill.

              Gold on navy is the mark's own pairing, and this is the one place
              in the app it fits — nothing in this list is a button, so the
              colour never has to carry text on top of itself. It also does the
              job better than the old treatment did: a slightly lighter navy
              pill was the only thing separating the current page from the
              rest, which is a difference you have to look for.

              A gold *background* was the other option and is worse. At any
              opacity that registers against navy it turns olive, and at full
              strength a solid gold pill is the loudest thing on the screen by
              some margin.
            */
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? [
                    "bg-sidebar-accent text-sidebar-active",
                    "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1",
                    "before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-active",
                  ]
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
