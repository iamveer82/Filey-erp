import React from "react";
import { MotionConfig } from "framer-motion";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { applyTheme, watchAppearance } from "./lib/theme";
import { applyAccent } from "./lib/accent";
import { watchViewport } from "./lib/viewport";
import { initMonitoring } from "./lib/monitoring";
import "flag-icons/css/flag-icons.min.css";
import "./index.css";

import "@fontsource-variable/inter/index.css";
// Display + document-template faces (design.md). Self-hosted so invoices/quotes
// print in the intended fonts instead of silently falling back to Inter/Georgia.
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { installExtensionBannerGuard } from "./lib/extension-guard";
import { startAutoSync } from "./lib/sync";
import { seedDefaultSkills } from "./lib/defaultSkills";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./lib/agentStorage";
import { quarantineLegacyCredentials } from "./lib/credentialStore";

applyTheme();
applyAccent();
const stopAppearanceSync = watchAppearance();
import.meta.hot?.dispose(stopAppearanceSync);
const stopViewport = watchViewport();
import.meta.hot?.dispose(stopViewport);
installExtensionBannerGuard();
// Recovery links contain a credential; do not initialize telemetry on this page.
if (!window.location.hash.startsWith("#/reset-password")) initMonitoring();
const stopAutoSync = startAutoSync();
import.meta.hot?.dispose(stopAutoSync);
// These services need the native sidecar. Web sign-in must not download their
// agent runtime; desktop still starts them once without blocking rendering.
if ("__TAURI_INTERNALS__" in window) {
  void import("./lib/desktopServices").then(({ startDesktopServices }) => startDesktopServices())
    .catch(() => console.warn("Desktop messaging could not start; open Integrations to retry."));
}
// Seed the default business-skill pack once, so the agent starts capable.
seedDefaultSkills();
let skillsScope = agentStorageScope();
const seedWorkspaceSkills = () => {
  const scope = agentStorageScope();
  if (scope === skillsScope) return;
  skillsScope = scope;
  seedDefaultSkills();
};
window.addEventListener(AGENT_STORAGE_EVENT, seedWorkspaceSkills);
import.meta.hot?.dispose(() => window.removeEventListener(AGENT_STORAGE_EVENT, seedWorkspaceSkills));
void quarantineLegacyCredentials().catch(() => console.warn("Legacy credential migration is pending; open AI settings to retry."));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
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
