"use client";

import { useEffect, useState } from "react";

/**
 * The QR square on an invoice, drawn on the device.
 *
 * It used to be generated on the server, which was one of the things keeping
 * the invoice screen there. It is a picture of a URL this device already
 * knows, so there was never anything to ask about — the only reason it lived
 * on the server is that is where the page happened to be.
 *
 * `qrcode` is pulled in with a dynamic import so it lands in its own chunk.
 * It is around twenty kilobytes and exactly one screen wants it; putting that
 * in the bundle every page loads, to draw a square most people never scan,
 * would trade a slow invoice screen for a slow everything.
 *
 * Nothing renders until the SVG exists. The alternative — a grey box that
 * becomes a code — is movement on a document somebody is reading.
 */
export function InvoiceQr({ url, size = 96 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const markup = await QRCode.toString(url, {
          type: "svg",
          margin: 0,
          width: size,
          color: { dark: "#0f172a", light: "#00000000" },
        });
        if (!cancelled) setSvg(markup);
      } catch {
        // A missing QR must never take the invoice down with it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (!svg) return null;

  return (
    <div
      className="size-24 [&>svg]:size-full"
      // Built here from our own URL by the qrcode package — never user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
