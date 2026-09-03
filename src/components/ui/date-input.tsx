"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A date field where the whole field opens the calendar.
 *
 * By default a browser puts the calendar behind a small icon at the right-hand
 * end of the input, perhaps sixteen pixels across. Every other control in this
 * app is a whole tappable area, and hitting that icon with a mouse — let alone
 * a thumb on a phone in a shop — takes aim that nothing else here demands.
 *
 * `showPicker()` is what browsers expose for this. It must be called from a
 * real user gesture, which a click is, and it throws rather than failing
 * quietly when it cannot open — in an unsupported browser, or when the input
 * is disabled or read-only. The catch is the fallback: the icon is still
 * there, and typing a date has never stopped working.
 *
 * Focus deliberately does not open it. Someone tabbing through a form wants to
 * type the date; only a deliberate click on the field means "show me a
 * calendar".
 */
export function DateInput({
  className,
  onClick,
  ref,
  ...props
}: React.ComponentProps<typeof Input>) {
  const inner = useRef<HTMLInputElement>(null);

  return (
    <Input
      {...props}
      type="date"
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        try {
          inner.current?.showPicker();
        } catch {
          // Unsupported, disabled, or refused. The built-in icon still works.
        }
      }}
      // The native icon stays as a visible affordance — people look for it —
      // but the cursor says the whole field is clickable.
      className={cn("cursor-pointer", className)}
    />
  );
}
