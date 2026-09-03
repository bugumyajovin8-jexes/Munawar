"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Package, Pencil, Plus } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FirstSync, isColdEmpty } from "@/components/offline/first-sync";
import { useAll, useAppSession, useSync } from "@/lib/offline/local";
import { ProductDialog } from "./product-dialog";
import { ProductRow } from "./product-row";
import type { Product } from "@/lib/types";

/**
 * The product list, read from this device.
 *
 * Cost prices are not a special case here, and deliberately so: the mirror is
 * filled from products_view, which returns buying_price and margin as NULL for
 * anyone who is not an admin. So a sales rep's device does not hold the cost
 * to be hidden — the same rule the server has always enforced, enforced once,
 * before the data ever reaches the phone.
 */
/**
 * The "New product" button, which only an admin is offered.
 *
 * The role comes from the device now rather than from a server render. That is
 * a presentation decision, not a permission one: a sales user who forced this
 * button to appear would find the write refused by the policies, and the cost
 * fields it edits arrive as NULL on their device in the first place.
 */
export function ProductsHeaderAction() {
  const session = useAppSession();
  if (session?.role !== "admin") return null;

  return (
    <ProductDialog
      trigger={
        <Button>
          <Plus className="size-4" />
          New product
        </Button>
      }
    />
  );
}

export function ProductsList() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const session = useAppSession();
  const isAdmin = session?.role === "admin";
  const syncState = useSync();
  const mirror = useAll<Product>("products");

  const products = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? mirror.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (p.sku ?? "").toLowerCase().includes(needle),
        )
      : mirror;

    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [mirror, query]);

  if (isColdEmpty(mirror.length, syncState)) {
    return <FirstSync state={syncState} noun="products" />;
  }

  const q = query;

  return (
    <>
      <div className="mb-4 max-w-md">
        <SearchInput placeholder="Search by name or SKU…" />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={<Package className="size-5" />}
          title={q ? "No products match that search" : "No products yet"}
          description={
            isAdmin
              ? "Add the things you sell, with a buying and selling price, and they become one-tap invoice lines."
              : "An administrator needs to add products before you can invoice them."
          }
          action={
            !q && isAdmin ? (
              <ProductDialog
                trigger={
                  <Button>
                    <Plus className="size-4" />
                    New product
                  </Button>
                }
              />
            ) : undefined
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>VAT</TableHead>
                  {isAdmin && <TableHead className="text-right">Buy</TableHead>}
                  <TableHead className="text-right">Sell</TableHead>
                  {isAdmin && <TableHead className="text-right">Margin</TableHead>}
                  {isAdmin && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <ProductRow key={p.id} product={p} isAdmin={isAdmin} />
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-2.5 lg:hidden">
            {products.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      per {p.unit}
                      {p.vat_applicable ? " · VAT 18%" : " · no VAT"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular font-medium">{formatMoney(p.selling_price)}</p>
                    {isAdmin && p.margin_pct !== null && (
                      <p className="tabular text-xs text-muted-foreground">
                        {p.margin_pct.toFixed(1)}% margin
                      </p>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="mt-3 flex justify-end">
                    <ProductDialog
                      product={p}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Pencil className="size-4" />
                          Edit
                        </Button>
                      }
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
