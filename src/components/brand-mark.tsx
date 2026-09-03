import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Munawar logo, wherever the app shows itself.
 *
 * One component so the brand lives in one place. It replaced a rounded square
 * of `bg-primary` with a lucide receipt glyph inside — a placeholder that had
 * outlived its purpose and, worse, was a different mark in four places at
 * once.
 *
 * Two forms, and the difference matters:
 *
 *   "mark"  the M alone. For the sidebar and the drawer, where it sits at
 *           thirty-six pixels next to the business name. The full logo there
 *           is a navy tile with an unreadable smudge on it, saying "Munawar"
 *           beside text that already says "Munawar".
 *   "full"  the whole icon, wordmark included. For sign-in and setup, where
 *           it is the only branding on the page and has room to be read.
 *
 * `unoptimized` is deliberate. Next's image optimiser serves through
 * /_next/image, which is a network round trip the service worker does not
 * cache — so on a phone with no signal the logo would be a hole on the one
 * screen where the app most needs to look like itself. The raw file is
 * precached with the shell instead. It is a small PNG; there is nothing for
 * the optimiser to win here anyway.
 *
 * No rounding class: the corners are already cut into the PNG at the same
 * proportion the artwork uses, so a `rounded-*` on top would clip it twice.
 */
export function BrandMark({
  variant = "mark",
  size = 36,
  className,
  alt = "",
}: {
  variant?: "mark" | "full";
  size?: number;
  className?: string;
  /** Leave empty where the business name is already beside it. */
  alt?: string;
}) {
  return (
    <Image
      src={variant === "mark" ? "/logo-mark.png" : "/icon-192.png"}
      alt={alt}
      width={size}
      height={size}
      // Above the fold on every screen it appears on, sign-in included.
      priority
      unoptimized
      className={cn("shrink-0", className)}
    />
  );
}
