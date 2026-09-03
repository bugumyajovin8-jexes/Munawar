import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "No connection" };

/**
 * The last resort, served by the service worker when a page is asked for that
 * this device has never seen. Pages that have been opened before are served
 * from their cached copy instead, so reaching this screen means genuinely new
 * territory rather than "offline" in general.
 *
 * Two constraints shape it, and both are easy to forget:
 *
 *   1. It is precached at install, before anyone has signed in, so it must
 *      render with no session and no data.
 *   2. It must work with no JavaScript at all. Its chunks are only in the cache
 *      if some earlier visit happened to pull them down, so hydration is not
 *      something this page can rely on. Every control here is a plain link —
 *      a button wired to an onClick would be dead exactly when it is needed.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
        <CloudOff className="size-6" />
      </div>

      <div>
        <h1 className="text-lg font-semibold">This page isn&rsquo;t saved yet</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          You have no connection, and this screen has not been opened on this
          device before, so there is nothing to show. Screens you have already
          visited still work.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/" prefetch={false}>
            Try again
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/invoices" prefetch={false}>
            Open invoices
          </Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Anything you save while offline is kept on this device and sent
        automatically as soon as you are back on the network. Nothing is lost.
      </p>
    </main>
  );
}
