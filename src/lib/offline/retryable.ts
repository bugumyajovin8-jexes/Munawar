/**
 * Telling "the server said no" apart from "the server never got the chance".
 *
 * The outbox treats a rejection as final — it stops the queue and shows the
 * item to a person, because retrying something the server refused on its
 * merits fails identically every time. That is right for a bad amount or a
 * missing permission, and completely wrong for a statement timeout: cash taken
 * in a shop ends up blocked behind a problem that fixed itself in the seconds
 * it took the user to look up.
 *
 * Getting this backwards is expensive in both directions, which is why it
 * lives in its own file with no server imports — /api/sync uses it, and
 * `npm run test:sync` can exercise it directly rather than through a route.
 */

/**
 * Postgres error classes that mean "the database, not the data".
 *
 *   08  connection exception
 *   40  transaction rollback — serialisation failures and deadlocks, both of
 *       which are expected under concurrency and both of which succeed on a
 *       second attempt
 *   53  insufficient resources — out of connections, out of memory, disk full
 *   57  operator intervention, which is where statement timeouts and admin
 *       shutdowns live
 *   XX  internal error
 *
 * None of these say anything about the operation itself, so none should ever
 * stop a queue permanently. Everything else — 22 data exception, 23 integrity
 * violation, 42 syntax or access rule violation, and every RAISE in our own
 * functions — is a decision about this operation and is final.
 */
const TRANSIENT_SQLSTATE = /^(08|40|53|57|XX)/;

/**
 * Transport failures, which arrive as prose rather than as a code.
 *
 * Deliberately narrow. A word like "failed" or "error" would match almost
 * every refusal our own functions raise, and turning a real rejection into an
 * endless retry is the worse mistake of the two: nothing would ever be shown
 * to the user, and the queue would grind against the server for ever.
 */
const TRANSIENT_TEXT =
  /\b(?:timeout|timed out|econnreset|econnrefused|etimedout|enotfound|socket hang up|fetch failed|network error|connection (?:closed|reset|refused|terminated)|temporarily unavailable|too many connections|service unavailable|bad gateway|gateway timeout)\b/i;

/** Was this worth trying again, or is it settled? */
export function isTransient(error: unknown): boolean {
  if (typeof error === "string") return TRANSIENT_TEXT.test(error);

  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_SQLSTATE.test(code)) return true;
    return TRANSIENT_TEXT.test(error.message);
  }

  // A PostgrestError is a plain object, not an Error.
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === "string" && TRANSIENT_SQLSTATE.test(code)) return true;
    if (typeof message === "string") return TRANSIENT_TEXT.test(message);
  }

  return false;
}

/**
 * requireSession() redirects when the session has gone, and redirect() works
 * by throwing.
 *
 * Caught alongside everything else it looked like an ordinary failure, so an
 * expired token turned every queued item into a permanent rejection reading
 * "NEXT_REDIRECT" — neither true nor actionable. It means sign in again, and
 * the queue already knows how to say that.
 */
export function isRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
