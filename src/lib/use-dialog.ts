"use client";

import { useState } from "react";

/**
 * A dialog that carries its own trigger, until somebody else wants to open it.
 *
 * These components started as self-contained: a button and the dialog it
 * opens, dropped onto a page. That stopped working once the invoice screen had
 * eight of them side by side and the rare ones moved into an overflow menu —
 * a menu item has to be the thing that opens the dialog, and the dialog itself
 * has to live outside the menu, because closing the menu unmounts everything
 * inside it and would take the dialog with it.
 *
 * So each one keeps its own button when nobody passes `open`, and gives it up
 * when somebody does. The caller supplying the state is also supplying the way
 * in, and two ways in would be one too many.
 */
export function useDialogState(
  controlledOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;

  return {
    open: isControlled ? controlledOpen : uncontrolledOpen,
    setOpen: (next: boolean) => {
      if (isControlled) onOpenChange?.(next);
      else setUncontrolledOpen(next);
    },
    /** False when the caller is driving — it has a trigger of its own. */
    showTrigger: !isControlled,
  };
}
