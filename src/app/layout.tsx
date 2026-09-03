import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Munawar — Invoicing",
    template: "%s · Munawar",
  },
  description: "Invoicing, customers and receivables for Tanzanian businesses.",
  // iOS ignores the web app manifest almost entirely: the home-screen icon and
  // the full-screen behaviour both come from these tags instead.
  appleWebApp: {
    capable: true,
    title: "Munawar",
    statusBarStyle: "default",
  },
  /*
   * src/app/favicon.ico is picked up by Next's file convention and is what a
   * browser tab shows — it holds the M alone, because the full logo does not
   * survive sixteen pixels. These are the larger ones, for a bookmark, a
   * pinned tab or an Android install.
   */
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches the manifest, so the installed app's status bar does not flash a
  // different colour on launch. See manifest.ts for where the value comes from.
  themeColor: "#09142f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // en-GB is deliberate: it makes Chrome render every <input type="date">
    // as DD/MM/YYYY, matching how dates are printed everywhere else.
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background">
        {/* First, so its listener is attached before the page's own scripts
            have a chance to fail. See the component for what it watches. */}
        <PwaRegister />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
