import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { NAV_ITEMS } from "@/lib/nav";

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

/** Roughly a working set. Deliberately small enough to fetch on mobile data. */
const MAX_INVOICES = 60;
const MAX_CUSTOMERS = 30;
const MAX_DRAFTS = 12;

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

  const { data: dueOrder } = unpaidIds.length
    ? await supabase
        .from("invoices")
        .select("id")
        .in("id", unpaidIds.slice(0, 400))
        .eq("status", "issued")
        .order("due_date")
        .limit(MAX_INVOICES)
    : { data: [] };

  for (const row of dueOrder ?? []) paths.push(`/invoices/${row.id}`);
  for (const row of drafts ?? []) paths.push(`/invoices/${row.id}`);
  for (const row of owing ?? []) paths.push(`/customers/${row.customer_id}`);

  return Response.json(
    { paths: [...new Set(paths)] },
    { headers: { "cache-control": "no-store" } },
  );
}
