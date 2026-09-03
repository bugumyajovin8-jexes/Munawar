"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePrefetchOnIntent } from "@/lib/prefetch";

/**
 * Whole-row click targets for tables.
 *
 * The trick is a stretched pseudo-element rather than an onClick handler on
 * <tr>: the row stays a real <a>, so middle-click, Ctrl+click, right-click →
 * "open in new tab" and keyboard focus all keep working. An onClick handler
 * would silently break every one of those.
 *
 * Usage:
 *   <TableRow className={rowLink}>
 *     <TableCell><RowLink href={`/invoices/${id}`}>{number}</RowLink></TableCell>
 *     ...
 *     <TableCell><RowAction><Button …/></RowAction></TableCell>
 *   </TableRow>
 *
 * Anything else interactive in the row must be wrapped in <RowAction>, or the
 * stretched overlay will swallow its clicks.
 *
 * `rowLink` must go on the <tr> itself, not on a cell or a wrapper: it is what
 * makes the row the containing block the overlay stretches to.
 */
/*
 * `relative` is what the stretched overlay in RowLink is meant to anchor to.
 * The transform is what makes that true in Safari.
 *
 * WebKit has never implemented `position: relative` on a <tr>. Blink and Gecko
 * both do, so this worked everywhere it was tested and failed on every Mac and
 * every iPhone — where the row was not a containing block at all, each row's
 * overlay fell through to the table wrapper (which is `relative`, see
 * ui/table.tsx), and every one of them stretched across the whole table. They
 * stacked, the last row in the DOM won, and the result was a list where
 * hovering anywhere highlighted the bottom row and clicking anywhere opened
 * it. Customer names still worked, because RowAction lifts them above the
 * overlay — which is exactly how the fault was identified.
 *
 * Any transform other than `none` makes an element a containing block for its
 * absolutely positioned descendants, in every engine including WebKit, and
 * table rows are transformable. `translate(0)` is deliberately 2D:
 * `translateZ(0)` would do the same job while promoting every row in a
 * two-hundred-row list to its own compositor layer.
 */
export const rowLink =
  "relative [transform:translate(0)] cursor-pointer focus-within:bg-muted/60";

export function RowLink({
  href,
  children,
  className,
}: {
  href: ComponentProps<typeof Link>["href"];
  children: ReactNode;
  className?: string;
}) {
  const prefetch = usePrefetchOnIntent();
  // router.prefetch only takes strings; the object form of href is not used
  // anywhere in this app, and skipping the prefetch is the safe degradation.
  const path = typeof href === "string" ? href : null;

  return (
    <Link
      href={href}
      onMouseEnter={path ? () => prefetch.onPointerEnter(path) : undefined}
      onMouseLeave={path ? prefetch.onPointerLeave : undefined}
      onTouchStart={path ? () => prefetch.onTouchStart(path) : undefined}
      className={cn(
        "font-medium hover:text-primary hover:underline",
        // Stretches this link across the whole row.
        "after:absolute after:inset-0 after:content-['']",
        // The row already highlights on hover; don't double up with a ring.
        "focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Lifts secondary controls above the stretched overlay so they stay clickable. */
export function RowAction({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("relative z-10", className)}>{children}</span>;
}
