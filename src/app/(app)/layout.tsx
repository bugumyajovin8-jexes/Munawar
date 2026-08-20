import { requireSession } from "@/lib/auth";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { FreshnessGuard } from "@/components/offline/freshness-guard";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Desktop: persistent sidebar. This is the primary surface. */}
      <AppSidebar
        orgName={session.org.name}
        userName={session.fullName ?? session.email}
        email={session.email}
        role={session.role}
      />

      {/* Phone: top bar with a drawer holding the same navigation. */}
      <MobileTopBar
        orgName={session.org.name}
        userName={session.fullName ?? session.email}
        email={session.email}
        role={session.role}
      />

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

      {/* Attaches the outbox and the page cache to this user. Renders nothing. */}
      <OfflineProvider userId={session.userId} />

      {/* Keeps the two caches in front of Supabase from going stale. */}
      <FreshnessGuard />
    </div>
  );
}
