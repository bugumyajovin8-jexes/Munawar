import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Styling lives in the `.skeleton` utility in globals.css
 * so the colour tokens and the sweep animation stay in one place.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("skeleton rounded-md", className)} {...props} />;
}

export { Skeleton };
