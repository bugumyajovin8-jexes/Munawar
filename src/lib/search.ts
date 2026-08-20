/**
 * Search helpers shared by server and client.
 *
 * Deliberately its own module rather than living next to <SearchInput>: that
 * file is `"use client"`, and every export of a client module becomes a client
 * reference. Importing this from a Server Component would typecheck happily
 * and then throw at request time.
 */

/**
 * Strips characters that would break PostgREST's `or=` filter grammar, so a
 * customer searching for "Ltd, (Dar)" cannot produce a malformed query.
 */
export function sanitiseQuery(q: string | undefined | null): string {
  return (q ?? "").replace(/[,()*]/g, " ").trim().slice(0, 80);
}
