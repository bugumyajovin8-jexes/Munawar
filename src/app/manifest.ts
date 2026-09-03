import type { MetadataRoute } from "next";

/**
 * PNG icons at 192 and 512 are what installers actually check for. Chrome will
 * accept an SVG, but iOS will not, and a manifest that installs everywhere is
 * worth three small files.
 *
 * There is no SVG entry any more. The logo is artwork — gradients, a script
 * wordmark, soft shading — and there is no honest vector of it, so what was
 * there was a placeholder glyph that looked nothing like the real mark. A
 * stale SVG is worse than none: where it was understood it won, and the app
 * showed a different icon in some places than in others.
 *
 * Built by scripts/make-icons.py, which is run by hand when the logo changes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Munawar — Invoicing & Receivables",
    short_name: "Munawar",
    description:
      "Invoicing, customers and receivables. Raise an invoice, record a payment and chase overdue accounts from your phone — online or off.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait-primary",
    /*
     * The splash stays the app's own near-white, because that is what the app
     * opens into. A navy splash followed by a light dashboard is a flash of
     * the wrong colour on every launch.
     */
    background_color: "#fdfdfe",
    /**
     * The icon's navy, measured from it rather than picked.
     *
     * Averaging the icon's field gives oklch(0.16 0.054 266) — #040b24. This
     * is that, lifted to L 0.20, because at the measured lightness a phone
     * status bar reads as plain black and the point is for it to read as the
     * logo. The hue is the icon's own and happens to be the hue the app's
     * sidebar was already using.
     *
     * It replaces #3f4fb4, an indigo that matched neither the logo nor the
     * app: on a phone the bar directly beneath it is the light top bar, so
     * the old value was a band of colour that appeared nowhere else.
     */
    theme_color: "#09142f",
    lang: "en-GB",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press the installed icon. These are the three things people open the
    // app to do, so they should not need the app open first.
    shortcuts: [
      {
        name: "New invoice",
        short_name: "New invoice",
        url: "/invoices/new",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Record a payment",
        short_name: "Payments",
        url: "/payments",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Chase overdue",
        short_name: "Reminders",
        url: "/reminders",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
