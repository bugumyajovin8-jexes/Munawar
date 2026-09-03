import "server-only";
import { headers } from "next/headers";

/**
 * Absolute origin for building shareable links.
 *
 * Set NEXT_PUBLIC_SITE_URL in production to pin it; otherwise it is derived
 * from the request, which is what makes preview deployments and localhost
 * produce working links without configuration.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

export async function publicInvoiceUrl(token: string): Promise<string> {
  return `${await siteUrl()}/i/${token}`;
}
