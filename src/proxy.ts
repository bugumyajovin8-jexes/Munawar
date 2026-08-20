import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  // customer-facing shareable invoice
  "/i/",
  // Cron jobs authenticate with a bearer token, not a session cookie. Without
  // this the proxy redirects Vercel Cron to /login and the job silently
  // never runs. The route handler rejects anything without CRON_SECRET.
  "/api/cron/",
  // PWA plumbing — a redirect here breaks installation and the offline page
  "/offline",
  "/sw.js",
  "/manifest.webmanifest",
  "/icon",
  "/apple-touch-icon",
  // The offline queue must be able to tell "not signed in" from "no network".
  // A redirect to /login would be followed by fetch() and arrive as a 200 with
  // an HTML body, which the queue would read as "sent successfully" and then
  // delete work that never reached the database. Both routes answer for
  // themselves: /api/ping is public by design, /api/sync returns a real 401.
  "/api/ping",
  "/api/sync",
  "/api/offline-manifest",
  // The mirror's read half. Same reasoning as the two above: it must answer
  // 401 for itself so the sync engine can tell a lost session from lost signal.
  "/api/pull",
  // Lending this device invoice numbers. Answers 401 for itself so a device
  // that has simply lost its session does not read a login page as a block.
  "/api/number-block",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes an expiring token and writes the new cookies onto `response`.
  // Must be getUser(), not getSession() — getSession trusts the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets and image files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
