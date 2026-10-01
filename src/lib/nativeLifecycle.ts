import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "./nativePlatform";
import { supabase } from "./supabase";
import { initMonitoring } from "./monitoring";
import { AI_CREDITS_EVENT } from "./aiCredits";

/** Only route known app links; credentials are verified by the recovery screen. */
export function nativeAppRoute(value: string): string | null {
  if (value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    if (!((url.protocol === "filey:" && url.hostname === "app") ||
      (url.protocol === "https:" && url.hostname === "app.gofiley.com"))) return null;
    const route = url.hash.startsWith("#/") ? url.hash.slice(1) : `${url.pathname}${url.search}`;
    const path = route.split("?")[0];
    if (/^\/portal\/[a-zA-Z0-9_-]{16,200}$/.test(path)) return path;
    if (!["/", "/settings", "/reset-password"].includes(path)) return null;
    const input = new URLSearchParams(route.split("?")[1] ?? "");
    const output = new URLSearchParams();
    for (const name of path === "/reset-password" ? ["token_hash", "email"] : path === "/settings" ? ["section", "checkout", "credit_checkout", "plan"] : []) {
      const entry = input.get(name);
      if (entry) output.set(name, entry);
    }
    return `${path}${output.size ? `?${output}` : ""}`;
  } catch { return null; }
}

export async function startNativeLifecycle(): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const android = Capacitor.getPlatform() === "android";
  const syncStatusBar = () => {
    const dark = document.documentElement.classList.contains("dark");
    void Promise.all([
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }),
      ...(android ? [StatusBar.setBackgroundColor({ color: dark ? "#0a0a0a" : "#ffffff" })] : []),
    ])
      .catch(() => { /* Cosmetic failure must not interrupt startup or auth. */ });
  };
  const routeLink = (url: string) => {
    const route = nativeAppRoute(url);
    if (!route || window.location.hash === `#${route}`) return;
    window.location.hash = route;
    // Public documents use the existing signed-out root, selected at boot.
    if (route.startsWith("/portal/")) window.location.reload();
  };
  let refreshing = false;
  const resume = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await supabase?.auth.getSession();
      // Existing account, billing, sync and data-cache listeners own their refreshes.
      window.dispatchEvent(new Event("focus"));
      if (navigator.onLine) window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event(AI_CREDITS_EVENT));
    } catch { /* preserve signed-in/offline work; existing flows expose retries */ }
    finally { refreshing = false; }
  };
  const handles = await Promise.all([
    App.addListener("appUrlOpen", ({ url }) => routeLink(url)),
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) { syncStatusBar(); supabase?.auth.startAutoRefresh(); void resume(); }
      else supabase?.auth.stopAutoRefresh();
    }),
    Browser.addListener("browserFinished", () => void resume()),
    App.addListener("backButton", ({ canGoBack }) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"][data-state="open"]')) {
        (document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches("input,textarea,[contenteditable=true]")) {
        active.blur();
        return;
      }
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    }),
  ]);
  const launch = await App.getLaunchUrl();
  if (launch) routeLink(launch.url);
  if (!window.location.hash.startsWith("#/reset-password")) initMonitoring();
  // Restore Android <=34's original layout; Android 35 still enforces edge-to-edge.
  if (android) void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  syncStatusBar();
  window.addEventListener("filey-ui", syncStatusBar);
  return () => {
    window.removeEventListener("filey-ui", syncStatusBar);
    handles.forEach(handle => void handle.remove());
  };
}
