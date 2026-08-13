// WhatsApp bridge (QR-paired session) — frontend side.
//
// The session itself runs as a sidecar the Rust layer supervises; this module
// only starts it, watches it, and remembers the two settings it needs. Desktop
// only: there is no session to run in a browser.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface BridgeState {
  /** stopped | starting | connecting | connected | reconnecting | logged_out | error */
  state: string;
  /** PNG data URL of the pairing QR, only while it is scannable. */
  qr?: string | null;
  error?: string | null;
}

const URL_KEY = "filey.wa_bridge.url";
const SECRET_KEY = "filey.wa_bridge.secret";
const AUTO_KEY = "filey.wa_bridge.auto";

export interface BridgeConfig {
  webhookUrl: string;
  secret: string;
  /** Start with the app, so WhatsApp is simply live after launch. */
  autoStart: boolean;
}

export function getBridgeConfig(): BridgeConfig {
  return {
    webhookUrl: localStorage.getItem(URL_KEY) ?? "",
    secret: localStorage.getItem(SECRET_KEY) ?? "",
    autoStart: localStorage.getItem(AUTO_KEY) === "1",
  };
}

export function setBridgeConfig(c: Partial<BridgeConfig>): BridgeConfig {
  if (c.webhookUrl !== undefined) localStorage.setItem(URL_KEY, c.webhookUrl.trim());
  if (c.secret !== undefined) localStorage.setItem(SECRET_KEY, c.secret.trim());
  if (c.autoStart !== undefined) localStorage.setItem(AUTO_KEY, c.autoStart ? "1" : "0");
  return getBridgeConfig();
}

export async function bridgeState(): Promise<BridgeState> {
  if (!hasDesktop) return { state: "stopped" };
  try {
    return await invoke<BridgeState>("wa_bridge_state");
  } catch {
    return { state: "stopped" };
  }
}

export async function startBridge(): Promise<BridgeState> {
  if (!hasDesktop) throw new Error("The WhatsApp bridge runs in the desktop app only.");
  const { webhookUrl, secret } = getBridgeConfig();
  if (!webhookUrl || !secret)
    throw new Error("Add the webhook URL and bridge secret first.");
  return invoke<BridgeState>("wa_bridge_start", { webhookUrl, secret });
}

export async function stopBridge(): Promise<void> {
  if (!hasDesktop) return;
  await invoke("wa_bridge_stop");
}

/** Live state pushed from the supervisor (QR arriving, connection opening). */
export function onBridgeState(cb: (s: BridgeState) => void): () => void {
  if (!hasDesktop) return () => {};
  const un = listen<BridgeState>("wa-bridge", (e) => cb(e.payload));
  return () => void un.then((f) => f()).catch(() => {});
}

/** Called once at boot: if the owner asked for it, bring WhatsApp up in the
 *  background so the app simply has a live channel after launch. Silent by
 *  design — a failure here must never block startup. */
export async function autoStartBridge(): Promise<void> {
  if (!hasDesktop) return;
  const { autoStart, webhookUrl, secret } = getBridgeConfig();
  if (!autoStart || !webhookUrl || !secret) return;
  try {
    await startBridge();
  } catch (e) {
    console.warn("WhatsApp bridge auto-start failed:", e);
  }
}
