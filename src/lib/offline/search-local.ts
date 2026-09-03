"use client";

/**
 * The Ctrl+K palette, searched against this device.
 *
 * It used to be a server action. That made it the last thing in the shell
 * still needing a connection, and it failed in the worst available way: the
 * call was awaited inside a setTimeout callback with nothing catching it, so
 * offline the rejection went unhandled, the result was never set, and the
 * palette showed a spinner that never stopped. No error, no results, and no
 * way to tell it had given up — on a control one keystroke away from every
 * screen in the app.
 *
 * Customers, invoices and products are all mirrored, so the search that could
 * not run offline was over data that had been on the device the whole time.
 *
 * The ordering lives in search-rank.ts, which has no imports at all and is
 * tested directly.
 */
import { getRows } from "./db";
import { rank } from "./search-rank";

export type SearchHit = {
  id: string;
  kind: "customer" | "invoice" | "product";
  title: string;
  subtitle: string | null;
  href: string;
};

type CustomerRow = { id: string; name: string; phone_e164: string | null };
type InvoiceRow = {
  id: string;
  number: string | null;
  draft_ref: string;
  customer_id: string;
};
type ProductRow = { id: string; name: string; sku: string | null };

export async function searchLocal(rawQuery: string): Promise<SearchHit[]> {
  const needle = rawQuery.trim().toLowerCase();
  if (needle.length < 2) return [];

  const [customers, invoices, products] = await Promise.all([
    getRows<CustomerRow>("customers"),
    getRows<InvoiceRow>("invoices"),
    getRows<ProductRow>("products"),
  ]);

  const names = new Map(customers.map((c) => [c.id, c.name]));
  const byTitle = (hit: SearchHit) => hit.title;

  return [
    ...rank<SearchHit>(
      customers.map((c) => ({
        item: {
          id: c.id,
          kind: "customer",
          title: c.name,
          subtitle: c.phone_e164,
          href: `/customers/${c.id}`,
        },
        fields: [c.name, c.phone_e164],
      })),
      needle,
      byTitle,
    ),
    ...rank<SearchHit>(
      invoices.map((i) => ({
        item: {
          id: i.id,
          kind: "invoice",
          title: i.number ?? i.draft_ref,
          subtitle: names.get(i.customer_id) ?? null,
          href: `/invoices/${i.id}`,
        },
        /*
         * The customer's name is searchable too, which the server version
         * could not offer without a join. "Ali" finding Ali's invoices is the
         * obvious thing to type and it used to return nothing.
         */
        fields: [i.number, i.draft_ref, names.get(i.customer_id)],
      })),
      needle,
      byTitle,
    ),
    ...rank<SearchHit>(
      products.map((p) => ({
        item: {
          id: p.id,
          kind: "product",
          title: p.name,
          subtitle: p.sku,
          href: "/products",
        },
        fields: [p.name, p.sku],
      })),
      needle,
      byTitle,
    ),
  ];
}
