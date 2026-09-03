/**
 * Which part of a customer's account a statement covers.
 *
 * In its own file, and this is not tidiness. The value is needed by the branch
 * filter, which is a client component, and by buildStatement, which reaches
 * for the database — importing the constant from lib/statement.ts pulled
 * `next/headers` and `server-only` into the browser bundle and failed the
 * build. Types are erased and cross that line freely; a runtime value does not.
 */

/**
 * Invoices raised for no branch.
 *
 * A distinct value rather than null, because null already means "do not filter
 * at all" — and the difference matters: one is the whole account, the other is
 * the head office's share of it.
 */
export const HEAD_OFFICE = "head-office";
