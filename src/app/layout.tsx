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
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches the manifest, so the installed app's status bar does not flash a
  // different colour on launch.
  themeColor: "#3f4fb4",
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
        {children}
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
