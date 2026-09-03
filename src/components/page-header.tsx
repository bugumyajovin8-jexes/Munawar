import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    /*
     * The row wraps, and the actions are allowed to shrink.
     *
     * They used to be `shrink-0`, which on a screen with several of them was
     * three separate bugs wearing one coat. A flex item that cannot shrink
     * claims its full max-content width, so the row grew past the viewport and
     * the page scrolled sideways — buttons on the right simply could not be
     * reached. What space was left went to the title, squeezed to its `min-w-0`
     * floor, which is why a customer's name broke onto two and three lines and
     * why the first button looked like it was sitting on top of the heading.
     *
     * Wrapping is the honest answer: when the buttons no longer fit beside the
     * heading they take a line of their own. The title's minimum keeps a name
     * on one line at any width worth having, and it is a minimum rather than a
     * fixed width so a narrow phone still falls back to the stacked column.
     */
    <div
      className={cn(
        "mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between lg:mb-6",
        className,
      )}
    >
      <div className="min-w-0 sm:min-w-[18rem] sm:flex-1">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      {icon && (
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div>
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
