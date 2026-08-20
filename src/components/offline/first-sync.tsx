"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { sync, type SyncState } from "@/lib/offline/sync";

/**
 * What a screen shows before this device has a copy of the business.
 *
 * Now that screens read the device rather than the server, an empty list is
 * ambiguous in a way it never used to be: it can mean "you have no customers"
 * or "this device has not been told about them yet". Those need different
 * words. Showing the first as though it were certain is how an app ends up
 * telling somebody with four hundred customers that they have none.
 *
 * So a cold mirror gets a loading state, a failed first sync gets the server's
 * own words and a way to try again, and only a mirror that has genuinely been
 * filled is allowed to say "nothing here".
 */
export function FirstSync({ state, noun }: { state: SyncState; noun: string }) {
  if (state.error) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          Could not download your {noun}
        </p>
        {/*
          The server's own message, verbatim. "Something went wrong" would hide
          exactly the detail that makes this fixable — a missing grant names the
          table it is missing on.
        */}
        <p className="text-sm text-muted-foreground">{state.error}</p>
        <Button variant="outline" size="sm" onClick={() => void sync()}>
          <RefreshCw className="size-4" />
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Downloading your {noun}…</span>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        Saving your {noun} to this device — this happens once.
      </p>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-2/3" />
    </Card>
  );
}

/** True when a screen has nothing local and no right to claim it is empty. */
export function isColdEmpty(rowCount: number, state: SyncState): boolean {
  return rowCount === 0 && (state.cold || state.error !== null);
}
