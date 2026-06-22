import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { applyTheme } from "./lib/theme";
import { initMonitoring } from "./lib/monitoring";
import "flag-icons/css/flag-icons.min.css";
import "./index.css";

import "@fontsource-variable/inter/index.css";
import { installExtensionBannerGuard } from "./lib/extension-guard";

applyTheme();
initMonitoring();
installExtensionBannerGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Service worker: the network-first PWA cache is for the hosted web build only.
// The Tauri desktop app serves its assets from the embedded bundle, so a SW adds
// no benefit and a real footgun — a cached shell can survive an app update and
// keep serving a stale/broken frontend (a blank window that no rebuild fixes).
// So under Tauri we never register, and we tear down any SW + caches a prior
// build left behind.
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

if (isTauri) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
  if ("caches" in window) {
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
} else if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((e) => console.error("Failed to register service worker:", e));
  });
}
