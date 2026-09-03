/**
 * How search results are ordered, with nothing else in the file.
 *
 * Separate from search-local.ts so it can be compiled and run by
 * `npm run test:sync` in a plain Node process — search-local imports the
 * IndexedDB wrapper, which does not exist there.
 *
 * Worth pinning, because ranking is the sort of thing that stops being useful
 * without ever failing. A search that returns the right rows in the wrong
 * order looks like it is working right up until somebody types three letters,
 * gets a stranger, and stops using it.
 */

/** Per kind, so one crowded kind cannot fill the list. */
export const PER_KIND = 5;

/**
 * How well a record matches, or null for not at all. Lower is better.
 *
 * Two rules, in order. An earlier field beats a later one, so a customer found
 * by name outranks one found by phone number. Within a field, a match at the
 * start beats one in the middle — typing "ali" should find "Ali Hassan"
 * before "Natalia".
 */
export function score(
  fields: (string | null | undefined)[],
  needle: string,
): number | null {
  let best: number | null = null;

  fields.forEach((field, index) => {
    if (!field) return;
    const at = field.toLowerCase().indexOf(needle);
    if (at === -1) return;

    // Field position dominates; position within the field breaks ties. The
    // gap between "starts with" and "contains" is deliberately wide enough
    // that no amount of offset can close it.
    const rank = index * 1000 + (at === 0 ? 0 : 100 + at);
    if (best === null || rank < best) best = rank;
  });

  return best;
}

export type Ranked<T> = { item: T; fields: (string | null | undefined)[] };

/** The best few matches, in order. */
export function rank<T>(
  candidates: Ranked<T>[],
  needle: string,
  tieBreak: (item: T) => string,
): T[] {
  const scored: { item: T; rank: number }[] = [];

  for (const candidate of candidates) {
    const value = score(candidate.fields, needle);
    if (value !== null) scored.push({ item: candidate.item, rank: value });
  }

  return scored
    .sort((a, b) => a.rank - b.rank || tieBreak(a.item).localeCompare(tieBreak(b.item)))
    .slice(0, PER_KIND)
    .map((s) => s.item);
}
