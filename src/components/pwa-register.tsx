"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so the app can be installed to a home screen.
 * Development is skipped — a cached worker while hot-reloading is nothing but
 * confusing.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is a nicety; never let it break the app.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
