import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { NAV_ITEMS } from "@/lib/nav";
import { selectIn } from "@/lib/supabase/chunked";

/**
 * Which screens are worth having on this device, most important first.
 *
 * "Download everything" is the obvious answer and the wrong one. A business
 * with two thousand invoices would mean two thousand server renders and six
 * thousand Supabase queries, repeated on every device, to cache paperwork from
 * three years ago that nobody is going to open standing in a shop.
 *
 * So the manifest is opinionated about what offline is actually for: money
 * that has not arrived yet. Unpaid invoices oldest-due first, because those are
 * the ones you chase; the customers who owe you, because that is who you visit;
 * the drafts, because those are the ones you are about to issue. Everything
 * else stays a normal online page and caches itself when opened.
 *
 * The budget below is a ceiling, not a target. A new business gets a handful of
 * pages and a busy one gets a hundred and ten, and neither downloads history.
 */
export const dynamic = "force-dynamic";

/**
 * Roughly a working set — and much smaller than it was.
 *
 * Sixty invoices and thirty customers meant about a hundred and ten pages, and
 * on a browser that has never seen the app none of them can be skipped: every
 * one is a real request, and the detail pages are still server-rendered, so
 * every one is a render plus its queries plus an auth check at the edge. A
 * fresh login fired all of that at once and took the middleware down with it.
 *
 * These numbers are what somebody plausibly opens away from a desk before the
 * next sync tops them up — not an attempt to mirror the filing cabinet.
 */
const MAX_INVOICES = 20;
const MAX_CUSTOMERS = 10;
const MAX_DRAFTS = 8;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const supabase = await createClient();
  const isAdmin = session.role === "admin";

  // The lists first: these are the screens someone opens by reflex, and they
  // are also the cheapest to render.
  const paths: string[] = NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin,
  ).map((item) => item.href);
  paths.push("/invoices/new");

  /*
   * Named here rather than taken from NAV_ITEMS.
   *
   * Both moved out of the sidebar into the account menu, which is a decision
   * about where they belong on screen — not about whether they are worth
   * having on the device. Reading the warm list off the navigation quietly
   * conflated the two, so moving a link stopped a page being downloaded.
   */
  paths.push("/recurring");
  if (isAdmin) paths.push("/settings");

  const [{ data: balances }, { data: owing }, { data: drafts }] = await Promise.all([
    supabase
      .from("invoice_balances")
      .select("invoice_id, balance, payment_state")
      .gt("balance", 0)
      .in("payment_state", ["unpaid", "partial"]),
    supabase
      .from("customer_balances")
      .select("customer_id, balance")
      .gt("balance", 0)
      .order("balance", { ascending: false })
      .limit(MAX_CUSTOMERS),
    supabase
      .from("invoices")
      .select("id")
      .eq("status", "draft")
      .order("order_date", { ascending: false })
      .limit(MAX_DRAFTS),
  ]);

  // Oldest due first — the ones being chased, not the ones just raised. The
  // ordering is applied here rather than in the query because invoice_balances
  // has no due date of its own.
  const unpaidIds = (balances ?? []).map((row) => row.invoice_id as string);

  /*
   * Chunked, so the id list never reaches the URL as one filter — and so the
   * arbitrary cap of four hundred that used to hide the rest can go.
   *
   * Each chunk returns its own oldest-due few; the globally oldest are
   * necessarily among them, so sorting the union and taking the front is the
   * same answer a single query would have given.
   */
  const { rows: dueOrder } = await selectIn<{ id: string; due_date: string | null }>(
    unpaidIds,
    (ids) =>
      supabase
        .from("invoices")
        .select("id, due_date")
        .in("id", ids)
        .eq("status", "issued")
        .order("due_date")
        .limit(MAX_INVOICES),
  );

  const oldestDue = dueOrder
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, MAX_INVOICES);

  for (const row of oldestDue) paths.push(`/invoices/${row.id}`);
  for (const row of drafts ?? []) paths.push(`/invoices/${row.id}`);
  for (const row of owing ?? []) paths.push(`/customers/${row.customer_id}`);

  return Response.json(
    { paths: [...new Set(paths)] },
    { headers: { "cache-control": "no-store" } },
  );
}
