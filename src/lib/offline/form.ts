/**
 * FormData is not structured-clonable into IndexedDB in every browser, and it
 * is not JSON either, so queued forms travel as plain key/value pairs and are
 * rebuilt into FormData in /api/sync.
 *
 * Only keys actually present are copied, which matters more than it looks:
 * an unchecked checkbox is absent from FormData, and the actions read that
 * absence as "true". Inventing keys here would quietly flip those defaults.
 */
export function formFields(data: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}
