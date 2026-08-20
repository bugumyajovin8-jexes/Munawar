"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { sanitiseQuery } from "@/lib/search";

export type SearchHit = {
  id: string;
  kind: "customer" | "invoice" | "product";
  title: string;
  subtitle: string | null;
  href: string;
};

/**
 * Powers the Ctrl+K palette. Deliberately narrow — invoice number, customer
 * name or phone, product name or SKU — because that is what you actually
 * search for when a customer is on the phone asking about a bill.
 */
export async function globalSearch(rawQuery: string): Promise<SearchHit[]> {
  await requireSession();

  const q = sanitiseQuery(rawQuery);
  if (q.length < 2) return [];

  const supabase = await createClient();

  const [customers, invoices, products] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone_e164")
      .or(`name.ilike.%${q}%,phone_e164.ilike.%${q}%`)
      .limit(5),
    supabase
      .from("invoices")
      .select("id, number, draft_ref, total, status, customer:customers(name)")
      .or(`number.ilike.%${q}%,draft_ref.ilike.%${q}%`)
      .limit(5),
    supabase
      .from("products_view")
      .select("id, name, sku, selling_price")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(5),
  ]);

  const hits: SearchHit[] = [];

  for (const c of customers.data ?? []) {
    hits.push({
      id: c.id as string,
      kind: "customer",
      title: c.name as string,
      subtitle: (c.phone_e164 as string | null) ?? null,
      href: `/customers/${c.id}`,
    });
  }

  for (const i of invoices.data ?? []) {
    const customer = Array.isArray(i.customer) ? i.customer[0] : i.customer;
    hits.push({
      id: i.id as string,
      kind: "invoice",
      title: (i.number as string | null) ?? (i.draft_ref as string),
      subtitle: (customer as { name?: string } | null)?.name ?? null,
      href: `/invoices/${i.id}`,
    });
  }

  for (const p of products.data ?? []) {
    hits.push({
      id: p.id as string,
      kind: "product",
      title: p.name as string,
      subtitle: (p.sku as string | null) ?? null,
      href: `/products`,
    });
  }

  return hits;
}
