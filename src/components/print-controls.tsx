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
    // Wait a frame so fonts and layout settle before the dialog opens.
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
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
