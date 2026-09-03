import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { newestIn, type Cursors, type TableCursor } from "@/lib/offline/sync-plan";
import { selectIn } from "@/lib/supabase/chunked";

/**
 * Everything that changed since this device last spoke to us.
 *
 * This is the read half of offline-first. The device keeps a mirror of the
 * business in IndexedDB and every screen reads from that, which is what makes
 * navigation instant with a connection and possible without one. This endpoint
 * keeps the mirror honest.
 *
 * Three decisions worth stating, because all three are load-bearing:
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
 *
 * Every table carries its own cursor. Each one is fetched with its own limit,
 * so they truncate at different points and a shared cursor taken across all of
 * them silently strides past whichever table was cut short. See TableCursor.
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

/** Tombstones are small, but not unbounded — they page like everything else. */
const DELETED_PAGE = 2000;

/**
 * How far back the first sync reaches.
 *
 * Only the cold fill is bounded. After that the device asks for "everything
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

type Row = Record<string, unknown>;

type TableSpec = {
  key: string;
  /** Often a view rather than the table, so the cost columns stay hidden. */
  from: string;
};

/** Tables with no relationship to an invoice — paged purely by updated_at. */
const FLAT_TABLES: TableSpec[] = [
  { key: "customers", from: "customers" },
  { key: "customerBranches", from: "customer_branches" },
  { key: "products", from: "products_view" },
  { key: "customerPrices", from: "customer_prices" },
];

/**
 * Children of an invoice. During the cold fill these follow their parents
 * exactly — every line of every invoice in the page, unlimited — rather than
 * being paged on dates of their own. A line without its invoice is noise, and
 * a page limit here is what would leave an invoice showing no items at all.
 */
const CHILD_TABLES: (TableSpec & { parent: string })[] = [
  { key: "invoiceItems", from: "invoice_items_view", parent: "invoice_id" },
  { key: "payments", from: "payments", parent: "invoice_id" },
  { key: "reminders", from: "reminders_log", parent: "invoice_id" },
];

function windowStart(): string {
  const from = new Date();
  from.setMonth(from.getMonth() - WINDOW_MONTHS);
  return from.toISOString().slice(0, 10);
}

/**
 * The cursors the device is holding, as it sent them.
 *
 * Anything malformed is dropped rather than rejected: a cursor the server
 * cannot read means that table starts its cold fill again, which costs
 * bandwidth. Refusing the whole request would cost the user their mirror.
 */
function readCursors(raw: string | null): Cursors {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: Cursors = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as { since?: unknown; cold?: unknown };
      if (typeof entry?.since === "string" && typeof entry?.cold === "boolean") {
        out[key] = { since: entry.since, cold: entry.cold };
      }
    }
    return out;
  } catch {
    return {};
  }
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

  /*
   * A device still running the previous build.
   *
   * It asks with `?since=<timestamp>` — one cursor for every table — and reads
   * `cursor` and `truncated` off the reply. This route stopped sending either,
   * so that client gets a response it cannot store a position from: it treats
   * every sync as a first sync, downloads the entire business, saves no
   * cursor, and does the same thing ninety seconds later. Forever. On a phone
   * that is a great deal of loading followed, eventually, by a timeout that
   * shows up as "offline".
   *
   * Answering the old shape instead is not an option — a single cursor is the
   * bug this replaced. So say plainly what is wrong. The old client surfaces
   * the message in its sync panel and stops asking until the page is reloaded,
   * which is exactly the thing that fixes it.
   */
  if (url.searchParams.has("since") && !url.searchParams.has("cursors")) {
    return Response.json(
      {
        error:
          "This app has been updated. Reload the page to carry on syncing — " +
          "close it and open it again if reloading does not help.",
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const cursors = readCursors(url.searchParams.get("cursors"));

  // The server's clock, read before the queries rather than after. Taking it
  // afterwards would hand back a cursor covering rows written during the read,
  // which the device would then never ask for again.
  const supabase = await createClient();
  const { data: nowRow } = await supabase.rpc("server_now");
  const clock = (nowRow as string | null) ?? new Date().toISOString();

  const changed: Record<string, Row[]> = {};
  const next: Record<string, TableCursor | null> = {};
  let more = false;

  /*
   * Tables this request could not read.
   *
   * One unreadable table used to fail the whole sync, so a missing grant on
   * customer_prices took customers, invoices and payments down with it and the
   * device mirrored nothing at all. A partial answer is worth far more than
   * none, and the parts that did work are exactly the ones the user needs.
   *
   * The failure is reported rather than swallowed, so a permission problem
   * surfaces as a named table in the console instead of a mirror that quietly
   * never fills — and its cursor is held still, so the rows it could not read
   * are still waiting when the grant is fixed.
   */
  const skipped: { table: string; reason: string }[] = [];

  function skip(key: string, reason: string) {
    skipped.push({ table: key, reason });
    changed[key] = [];
    next[key] = null;
  }

  /**
   * Record a table's page and decide where it has got to.
   *
   * `paged` is the rows the limit actually applied to. It matters where a
   * query is a union of two: an old unpaid invoice fetched by id alongside the
   * windowed page could easily be the most recently touched row in the set,
   * and taking the cursor from it would skip every windowed invoice in
   * between.
   */
  function settle(
    key: string,
    rows: Row[],
    truncated: boolean,
    cold: boolean,
    paged: Row[] = rows,
  ) {
    changed[key] = rows;

    if (!truncated) {
      next[key] = { since: clock, cold: false };
      return;
    }

    more = true;
    const newest = newestIn(paged as { updated_at?: string }[]);
    // A full page with no usable timestamp cannot be resumed from. Holding
    // still is the honest answer; the client reports it as stalled.
    next[key] = newest ? { since: newest, cold } : null;
  }

  /** One `in(...)` filter, split so the id list never outgrows the URL. */
  function fetchByParents(from: string, column: string, ids: string[]) {
    return selectIn<Row>(ids, (chunk) =>
      supabase.from(from).select("*").in(column, chunk),
    );
  }

  // ------------------------------------------------------------ invoices ---
  /*
   * The cold fill is two questions rather than one: what is recent, and what
   * is still owed. A business three years in would otherwise pull its whole
   * history down a mobile connection the first time someone signs in.
   *
   * The window stays applied for as long as the fill is running, so a cold
   * start that needs four pages is still four pages of the last eighteen
   * months rather than four pages of everything. Once it completes, the table
   * switches to the plain unbounded delta — by then that only ever describes
   * what actually changed.
   */
  const invoiceCursor = cursors.invoices;
  const invoicesCold = !invoiceCursor || invoiceCursor.cold;

  let invoiceIds: string[] = [];
  let invoicesTruncated = false;
  let invoicesReadable = true;

  if (invoicesCold) {
    let query = supabase
      .from("invoices")
      .select("*")
      .gte("order_date", windowStart())
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    if (invoiceCursor) query = query.gte("updated_at", invoiceCursor.since);

    const { data, error } = await query;

    if (error) {
      invoicesReadable = false;
      skip("invoices", error.message);
    } else {
      const paged = (data ?? []) as Row[];
      invoicesTruncated = paged.length >= PAGE;

      const rows = new Map<string, Row>();
      for (const row of paged) rows.set(String(row.id), row);

      // Only on the very first request. Afterwards these are already here, and
      // re-fetching them on every page of the fill would be pure waste.
      if (!invoiceCursor) {
        const [{ data: drafts }, { data: owing }] = await Promise.all([
          // Whatever the user is part-way through, whatever its date.
          supabase.from("invoices").select("*").eq("status", "draft"),
          supabase
            .from("invoice_balances")
            .select("invoice_id")
            .gt("balance", 0)
            .limit(MAX_CARRIED_OVER),
        ]);

        for (const row of (drafts ?? []) as Row[]) rows.set(String(row.id), row);

        // Older invoices that still matter, fetched by id rather than by date.
        const missing = (owing ?? [])
          .map((row) => String(row.invoice_id))
          .filter((id) => !rows.has(id));

        if (missing.length > 0) {
          const carried = await fetchByParents(
            "invoices",
            "id",
            missing.slice(0, MAX_CARRIED_OVER),
          );
          for (const row of carried.rows) rows.set(String(row.id), row);
        }
      }

      invoiceIds = [...rows.keys()];
      settle("invoices", [...rows.values()], invoicesTruncated, true, paged);
    }
  } else {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .gte("updated_at", invoiceCursor.since)
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    if (error) {
      invoicesReadable = false;
      skip("invoices", error.message);
    } else {
      const rows = (data ?? []) as Row[];
      invoicesTruncated = rows.length >= PAGE;
      settle("invoices", rows, invoicesTruncated, false);
    }
  }

  // ------------------------------------------------------- flat tables -----
  for (const table of FLAT_TABLES) {
    const cursor = cursors[table.key];

    let query = supabase
      .from(table.from)
      .select("*")
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    // No cursor means this table has never been read — either a first sync, or
    // one whose grant was missing until now. Either way it pages from the
    // beginning, which is the whole of the healing this needs.
    if (cursor) query = query.gte("updated_at", cursor.since);

    const { data, error } = await query;
    if (error) {
      skip(table.key, error.message);
      continue;
    }

    const rows = (data ?? []) as Row[];
    settle(table.key, rows, rows.length >= PAGE, false);
  }

  // ----------------------------------------------------- invoice children --
  for (const table of CHILD_TABLES) {
    const cursor = cursors[table.key];

    /*
     * While the invoices fill is running these follow it page for page: every
     * child row of every invoice in this page, with no limit of their own.
     *
     * A limit here is what would let an invoice arrive with half its lines, and
     * paging them separately is what would leave the other half behind — the
     * page boundaries of parent and child do not line up, and there is no
     * cursor that reconciles them. Following the parents removes the question.
     */
    if (invoicesCold) {
      if (!invoicesReadable) {
        // No parents to follow. Say nothing rather than guess.
        changed[table.key] = [];
        next[table.key] = null;
        continue;
      }

      if (invoiceIds.length > 0) {
        const result = await fetchByParents(table.from, table.parent, invoiceIds);
        if (result.error) {
          skip(table.key, result.error);
          continue;
        }
        changed[table.key] = result.rows;
      } else {
        changed[table.key] = [];
      }

      /*
       * Their phase is their parent's. Handing them a cursor while invoices
       * are still arriving would mark them complete at a moment when whole
       * invoices — and therefore whole sets of lines — are still to come.
       */
      next[table.key] = invoicesTruncated ? null : { since: clock, cold: false };
      continue;
    }

    let query = supabase
      .from(table.from)
      .select("*")
      .order("updated_at", { ascending: true })
      .limit(PAGE);

    if (cursor) query = query.gte("updated_at", cursor.since);

    const { data, error } = await query;
    if (error) {
      skip(table.key, error.message);
      continue;
    }

    const rows = (data ?? []) as Row[];
    settle(table.key, rows, rows.length >= PAGE, false);
  }

  // ------------------------------------------------------------ deleted ----
  const deletedCursor = cursors.deleted;
  let deletedQuery = supabase
    .from("deleted_rows")
    .select("table_name, row_key, deleted_at")
    .order("deleted_at", { ascending: true })
    .limit(DELETED_PAGE);

  if (deletedCursor) deletedQuery = deletedQuery.gte("deleted_at", deletedCursor.since);

  const { data: deleted, error: deletedError } = await deletedQuery;
  let tombstones: Row[] = [];

  if (deletedError) {
    skip("deleted", deletedError.message);
  } else {
    tombstones = (deleted ?? []) as Row[];
    if (tombstones.length >= DELETED_PAGE) {
      more = true;
      const newest = newestIn(
        tombstones.map((row) => ({ updated_at: String(row.deleted_at ?? "") })),
      );
      next.deleted = newest ? { since: newest, cold: false } : null;
    } else {
      next.deleted = { since: clock, cold: false };
    }
  }

  return Response.json(
    {
      changed,
      deleted: tombstones,
      /** Where each table has got to. Null means "stay where you were". */
      next,
      /** At least one table came back full, so the device asks again. */
      more,
      skipped,
      /** Lets the device notice a sign-in as somebody else and start clean. */
      userId: session.userId,
      orgId: session.orgId,
      role: session.role,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
