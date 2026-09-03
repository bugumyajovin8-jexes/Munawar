"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "@/lib/nav";

/** Thumb-reachable navigation on phones. Desktop uses the sidebar instead. */
export function MobileTabBar() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.primary);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          // "/" is the app's home, so its tab carries the app's mark.
          const isHome = item.href === "/";
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {isHome ? (
                  /*
                    The mark, greyed out until you are actually on it.

                    Left in colour it is by far the brightest thing in the bar
                    whichever tab you are on, so the one element that catches
                    the eye is not the one telling you where you are — the
                    opposite of what a tab bar is for. Greyscale sits it with
                    the muted line icons beside it and lets the gold arrive as
                    the signal, which is the same job it does in the sidebar.

                    This bar is white, so the gold could not be the active
                    colour here as it is on the navy sidebar: it manages
                    1.6:1 against white. The label keeps the indigo the other
                    tabs use.
                  */
                  <BrandMark
                    size={20}
                    className={cn("transition", !active && "opacity-60 grayscale")}
                  />
                ) : (
                  <Icon className={cn("size-5", active && "stroke-[2.4]")} />
                )}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
