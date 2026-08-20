import type { MetadataRoute } from "next";

/**
 * PNG icons at 192 and 512 are what installers actually check for. Chrome will
 * accept an SVG, but iOS will not, and a manifest that installs everywhere is
 * worth four small files. The SVG entries stay for crisp rendering wherever
 * they are understood.
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
    background_color: "#fdfdfe",
    theme_color: "#3f4fb4",
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
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
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
