"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { RowAction } from "@/components/row-link";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProductDialog } from "./product-dialog";
import type { Product } from "@/lib/types";

/**
 * A product row has no URL to open — the natural action is "edit" — so unlike
 * the other tables this one uses a click handler rather than a stretched link.
 * Sales users get a plain, non-interactive row: they cannot edit products.
 */
export function ProductRow({
  product,
  isAdmin,
}: {
  product: Product;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className={cn(isAdmin && "cursor-pointer")}
        onClick={isAdmin ? () => setOpen(true) : undefined}
        onKeyDown={
          isAdmin
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
        tabIndex={isAdmin ? 0 : undefined}
        role={isAdmin ? "button" : undefined}
        aria-label={isAdmin ? `Edit ${product.name}` : undefined}
      >
        <TableCell>
          <span className="font-medium">{product.name}</span>
          {!product.is_active && (
            <Badge variant="muted" className="ml-2">
              Inactive
            </Badge>
          )}
          {product.sku && (
            <p className="text-xs text-muted-foreground">{product.sku}</p>
          )}
        </TableCell>

        <TableCell className="text-muted-foreground">{product.unit}</TableCell>

        <TableCell>
          {product.vat_applicable ? (
            <Badge variant="outline">18%</Badge>
          ) : (
            <Badge variant="muted">None</Badge>
          )}
        </TableCell>

        {isAdmin && (
          <TableCell className="text-right tabular text-muted-foreground">
            {formatMoney(product.buying_price ?? 0)}
          </TableCell>
        )}

        <TableCell className="text-right tabular font-medium">
          {formatMoney(product.selling_price)}
        </TableCell>

        {isAdmin && (
          <TableCell className="text-right tabular">
            {product.margin_pct === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span
                className={
                  product.margin_pct < 0
                    ? "font-medium text-destructive"
                    : "text-success"
                }
              >
                {product.margin_pct.toFixed(1)}%
              </span>
            )}
          </TableCell>
        )}

        {isAdmin && (
          <TableCell>
            <RowAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${product.name}`}
                onClick={(e) => {
                  // The row already handles this; don't open it twice.
                  e.stopPropagation();
                  setOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
            </RowAction>
          </TableCell>
        )}
      </TableRow>

      {isAdmin && (
        <ProductDialog product={product} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
