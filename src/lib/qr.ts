import "server-only";
import QRCode from "qrcode";

/**
 * QR code as an inline SVG string.
 *
 * SVG rather than a PNG data URI so it stays crisp when the invoice is
 * printed, and costs a couple of hundred bytes instead of a few kilobytes.
 */
export async function qrSvg(text: string, size = 96): Promise<string | null> {
  try {
    return await QRCode.toString(text, {
      type: "svg",
      margin: 0,
      width: size,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  } catch {
    // A missing QR must never take the invoice down with it.
    return null;
  }
}
