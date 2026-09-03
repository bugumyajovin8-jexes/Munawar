"use client";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { FreshnessGuard } from "@/components/offline/freshness-guard";
import { useAppSession } from "@/lib/offline/local";

/**
 * The application chrome, rendered from the device.
 *
 * This used to be a server component calling requireSession(), which read
 * cookies — and reading cookies is what forced Next to render every route on
 * demand. That single call was the reason navigation still cost a request to
 * Vercel and two round trips to Supabase, long after the pages themselves had
 * stopped fetching anything.
 *
 * Moving it here makes the routes static, so Next can prefetch a whole page
 * and a click becomes a component swap with no network at all — which is the
 * only way to be genuinely instant rather than merely quick.
 *
 * Access control has not moved. The proxy checks the session on every request
 * that actually reaches the server and redirects anyone without one; this only
 * changes where the shell reads the user's name and org from.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useAppSession();

  // First paint on a device that has never loaded before. The chrome is drawn
  // without names rather than held back — an empty sidebar for a moment beats
  // a blank screen, and every route below renders regardless.
  const orgName = session?.orgName ?? "";
  const userName = session?.fullName ?? session?.email ?? "";
  const email = session?.email ?? "";
  const role = session?.role ?? "sales";

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Desktop: persistent sidebar. This is the primary surface. */}
      <AppSidebar orgName={orgName} userName={userName} email={email} role={role} />

      {/* Phone: top bar with a drawer holding the same navigation. */}
      <MobileTopBar orgName={orgName} userName={userName} email={email} role={role} />

      {/* print:pl-0 — the sidebar is hidden on paper, so its gutter must go too */}
      {/* No offline banner across the top of every page: the connection state
          lives in the sync chip in the sidebar and the phone header, which is
          where the rest of the offline detail already is. */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        {/* print:!p-[12mm] — @page now has zero margin so the browser prints no
            header or footer, which means in-app printing (statements, reports)
            has to supply its own paper margin. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-10 print:max-w-none print:!p-[12mm]">
          {children}
        </main>
      </div>

      <MobileTabBar />

      {/* Attaches the outbox, the mirror and the page cache to this user.
          Renders nothing, and waits until the session is actually known. */}
      {session && <OfflineProvider userId={session.userId} />}

      {/* Keeps the two caches in front of Supabase from going stale. */}
      <FreshnessGuard />
    </div>
  );
}
