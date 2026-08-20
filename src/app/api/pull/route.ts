import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

/**
 * Everything that changed since this device last spoke to us.
 *
 * This is the read half of offline-first. The device keeps a mirror of the
 * business in IndexedDB and every screen reads from that, which is what makes
 * navigation instant with a connection and possible without one. This endpoint
 * keeps the mirror honest.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 * It goes through the ordinary server Supabase client, so RLS, the column
 * grants and the definer views all apply exactly as they do everywhere else.
 * Nothing here re-implements permissions. In particular products and invoice
 * items are read through products_view and invoice_items_view, which return
 * buying_price, unit_cost and margin as NULL unless the caller is an admin —
 * so a sales rep's phone physically does not contain the cost prices. That
 * matters far more for a mirror than for a page render: the page is gone when
 * you close it, the mirror sits on the device until someone signs out.
 *
 * Deletions come from the tombstone table rather than being inferred. A row
 * that is simply gone cannot be found by a query over rows that still exist,
 * so without 0007's deleted_rows a device that had been away would keep a
 * deleted customer forever and, worse, let someone invoice them.
 */
export const dynamic = "force-dynamic";

/**
 * Per table, per request. The client loops until nothing is truncated, so this
 * is a memory ceiling rather than a limit on how much can be mirrored.
 *
 * The cursor is a timestamp and the comparison is `>=`, which can re-send the
 * rows sitting exactly on the boundary. That is deliberate: re-sending is free
 * because applying a row is an upsert, whereas `>` would silently drop rows
 * that happened to share a microsecond with the previous page's last row.
 */
const PAGE = 500;

/**
 * How far back the first sync reaches.
 *
 * Only the cold start is bounded. After that the device asks for "everything
 * newer than my cursor", which is small by definition however long it has been
 * away — and unbounded, so nothing recent is ever missed.
 *
 * The window alone would be wrong. An invoice from three years ago that is
 * still unpaid is precisely the money the user is chasing, and dropping it off
 * their phone because of its age would be the worst possible reading of
 * "recent". So anything still owing, and anything still a draft, comes down
 * regardless of how old it is.
 */
const WINDOW_MONTHS = 18;
/** PostgREST puts an id list in the URL, so the escape hatch needs a ceiling. */
const MAX_CARRIED_OVER = 1000;

type TableSpec = {
  key: string;
  /** Often a view rather than the table, so the cost columns stay hidden. */
  from: string;
  /** Children of an invoice: on a cold start, limited to the invoices sent. */
  invoiceScoped?: boolean;
};

/**
 * Order matters on the client: a row is only useful once the rows it points at
 * are present, so parents come first. Invoices are handled separately below,
 * because their cold-start selection is not a single filter.
 */
const TABLES: TableSpec[] = [
  { key: "customers", from: "customers" },
  { key: "products", from: "products_view" },
  { key: "customerPrices", from: "customer_prices" },
  { key: "invoiceItems", from: "invoice_items_view", invoiceScoped: true },
  { key: "payments", from: "payments", invoiceScoped: true },
  { key: "reminders", from: "reminders_log", invoiceScoped: true },
];

function windowStart(): string {
  const from = new Date();
  from.setMonth(from.getMonth() - WINDOW_MONTHS);
  return from.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    // A real 401, never a redirect: the sync engine has to be able to tell
    // "signed out" from "no signal", and a redirect followed by fetch() would
    // arrive as a 200 full of HTML.
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const cold = !since;

  // The server's clock, read before the queries rather than after. Taking it
  // afterwards would hand back a cursor covering rows written during the read,
  // which the device would then never ask for again.
  const supabase = await createClient();
  const { data: nowRow } = await supabase.rpc("server_now");
  const cursor = (nowRow as string | null) ?? new Date().toISOString();

  const changed: Record<string, unknown[]> = {};
  let truncated = false;

  /*
   * Tables this request could not read.
   *
   * One unreadable table used to fail the whole sync, so a missing grant on
   * customer_prices took customers, invoices and payments down with it and the
   * device mirrored nothing at all. That is the same mistake the warm run made
   * before it was taught to skip a page it could not fetch: a partial answer
   * is worth far more than none, and the parts that did work are exactly the
   * ones the user needs offline.
   *
   * The failure is reported rather than swallowed, so a permission problem
   * surfaces as a named table in the console instead of a mirror that quietly
   * never fills.
   */
  const skipped: { table: string; reason: string }[] = [];

  // ------------------------------------------------------------ invoices ---
  /*
   * On a cold start this is two questions rather than one: what is recent, and
   * what is still owed. A business three years in would otherwise pull its
   * whole history down a mobile connection the first time someone signs in.
   *
   * Every later sync is the plain delta, unbounded — by then it only ever
   * describes what actually changed.
   */
  let invoiceIds: string[] = [];

  if (cold) {
    const [{ data: recent }, { data: owing }, { data: drafts }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*")
        .gte("order_date", windowStart())
        .order("updated_at", { ascending: true })
        .limit(PAGE),
      supabase
        .from("invoice_balances")
        .select("invoice_id")
        .gt("balance", 0)
        .limit(MAX_CARRIED_OVER),
      // Whatever the user is part-way through, whatever its date.
      supabase.from("invoices").select("*").eq("status", "draft"),
    ]);

    const rows = new Map<string, Record<string, unknown>>();
    for (const row of recent ?? []) rows.set(String(row.id), row);
    for (const row of drafts ?? []) rows.set(String(row.id), row);

    // Older invoices that still matter, fetched by id rather than by date.
    const missing = (owing ?? [])
      .map((row) => String(row.invoice_id))
      .filter((id) => !rows.has(id));

    if (missing.length > 0) {
      const { data: carried } = await supabase
        .from("invoices")
        .select("*")
        .in("id", missing.slice(0, MAX_CARRIED_OVER));
      for (const row of carried ?? []) rows.set(String(row.id), row);
    }

    changed.invoices = [...rows.values()];
    invoiceIds = [...rows.keys()];
    if ((recent?.length ?? 0) >= PAGE) truncated = true;
  } else {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .gte("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    if (error) {
      skipped.push({ table: "invoices", reason: error.message });
      changed.invoices = [];
    } else {
      changed.invoices = data ?? [];
      if ((data?.length ?? 0) >= PAGE) truncated = true;
    }
  }

  // ----------------------------------------------------------- the rest ----
  for (const table of TABLES) {
    let query = supabase
      .from(table.from)
      .select("*")
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    if (since) {
      query = query.gte("updated_at", since);
    } else if (table.invoiceScoped) {
      /*
       * Cold start: a line or a payment is meaningless without its invoice, so
       * these follow whichever invoices were selected above rather than being
       * windowed on dates of their own.
       *
       * No such scoping is needed afterwards — 0007 makes a child touch its
       * parent's updated_at, so an invoice always travels in the same delta as
       * a payment recorded against it, however old the invoice is.
       */
      if (invoiceIds.length === 0) {
        changed[table.key] = [];
        continue;
      }
      query = query.in("invoice_id", invoiceIds.slice(0, MAX_CARRIED_OVER));
    }

    const { data, error } = await query;
    if (error) {
      skipped.push({ table: table.key, reason: error.message });
      changed[table.key] = [];
      continue;
    }

    changed[table.key] = data ?? [];
    if ((data?.length ?? 0) >= PAGE) truncated = true;
  }

  // Tombstones are cheap and there are never many, so they are not paged.
  let deletedQuery = supabase
    .from("deleted_rows")
    .select("table_name, row_key, deleted_at")
    .order("deleted_at", { ascending: true })
    .limit(2000);

  if (since) deletedQuery = deletedQuery.gte("deleted_at", since);

  const { data: deleted, error: deletedError } = await deletedQuery;
  if (deletedError) skipped.push({ table: "deleted_rows", reason: deletedError.message });

  return Response.json(
    {
      /**
       * When a page came back full there is more to fetch, and the device must
       * NOT store this cursor — doing so would skip everything past the cut.
       * It re-asks from the last row it actually received instead.
       */
      cursor: truncated ? null : cursor,
      truncated,
      changed,
      deleted: deleted ?? [],
      skipped,
      /** Lets the device notice a sign-in as somebody else and start clean. */
      userId: session.userId,
      orgId: session.orgId,
      role: session.role,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
