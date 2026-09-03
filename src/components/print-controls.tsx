"use client";

import { useEffect } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PrintControls({
  invoiceId,
  autoPrint,
}: {
  invoiceId: string;
  autoPrint?: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;

    /*
     * Wait for the webfonts, not for a guess at how long they take.
     *
     * This used to be a flat 400ms, which was fine while it was a convenience
     * nobody relied on. Every print now arrives here with auto=1, so it is the
     * only thing standing between the click and the paper — and printing
     * before Geist has loaded lays the document out in a fallback face, at
     * different widths, which is how a total ends up on the wrong line of a
     * PDF sent to a customer.
     *
     * document.fonts.ready settles when they are done. The timeout is a
     * backstop for a browser that never resolves it rather than the plan.
     */
    let cancelled = false;
    const print = () => {
      if (!cancelled) window.print();
      cancelled = true;
    };

    const backstop = setTimeout(print, 2500);
    const fonts = document.fonts?.ready ?? Promise.resolve();

    void fonts.then(() => {
      // One frame past the font swap, so the relayout has been painted.
      requestAnimationFrame(() => requestAnimationFrame(print));
    });

    return () => {
      cancelled = true;
      clearTimeout(backstop);
    };
  }, [autoPrint]);

  return (
    <div className="mx-auto flex w-full max-w-[210mm] items-center justify-between gap-3 px-4 py-4 print:hidden">
      <Button variant="ghost" asChild>
        <Link href={`/invoices/${invoiceId}`}>
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </Button>
      <Button onClick={() => window.print()}>
        <Printer className="size-4" />
        Print / Save as PDF
      </Button>
    </div>
  );
}
