import "server-only";

/**
 * Reading rows by a list of ids, without putting the list in a URL.
 *
 * PostgREST takes `in.(…)` as a query string, so `.in("invoice_id", ids)`
 * sends every id in the URL. A uuid is 36 characters, so a few hundred rows
 * is tens of kilobytes of it — past what a proxy in front of the database
 * accepts, and the failure comes back as a bare 400 or 414 with nothing in it
 * that names the cause.
 *
 * It went wrong in four places independently, which is why this exists rather
 * than a note in each of them. It went wrong *silently* in three of those,
 * because the pattern that produces it —
 *
 *     const { data } = await supabase.from(…).in("id", ids)
 *
 * — drops the error on the floor by construction. A customer statement then
 * renders every invoice with no payments against it, and an export writes a
 * margin of zero. Both are documents somebody acts on.
 *
 * So the error is in the return type here and cannot be ignored by accident.
 */

/**
 * Ids per request. Eighty uuids is roughly 3 KB of query string, comfortably
 * inside every limit, and the chunks run in sequence so a large read is slow
 * rather than heavy.
 */
export const ID_CHUNK = 80;

type Result<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Runs `query` once per chunk and concatenates the rows.
 *
 * Anything the caller needs ordered must be sorted afterwards: each chunk is
 * ordered within itself, and concatenating ordered chunks does not produce an
 * ordered whole.
 */
export async function selectIn<T>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<Result<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  if (ids.length === 0) return { rows: [], error: null };

  const rows: T[] = [];

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await query(ids.slice(i, i + ID_CHUNK));
    // A partial answer here is worse than none: the caller would treat the
    // rows it did get as the complete set and compute a wrong total from them.
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as T[]));
  }

  return { rows, error: null };
}
