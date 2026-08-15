// WhatsApp bridge (QR-paired session) — frontend side.
//
// The session itself runs as a sidecar the Rust layer supervises; this module
// only starts it, watches it, and remembers whether to start with the app.
// Desktop only: there is no session to run in a browser.
//
// LOCAL AGENT: no webhook anymore. Incoming WhatsApp messages arrive on the
// `wa-message` event and the app's own agent answers through replyWa(). The
// brain, memory and tools all live in this app — nothing is sent to a server.
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
  /** The paired JID once connected (owner's own chat in self-chat mode). */
  me?: string | null;
}

const AUTO_KEY = "filey.wa_bridge.auto";
const OWNER_KEY = "filey.wa_bridge.owner";

export interface BridgeConfig {
  /** Start with the app, so WhatsApp is simply live after launch. */
  autoStart: boolean;
  /** The number the agent takes orders from, when it isn't the paired account
   *  itself — pair a spare SIM as the bot and this is your own phone. Empty
   *  means self-chat only. */
  ownerNumber: string;
}

export function getBridgeConfig(): BridgeConfig {
  return {
    // Default ON: WhatsApp should simply be live after launch. Opt out with "0".
    autoStart: localStorage.getItem(AUTO_KEY) !== "0",
    ownerNumber: localStorage.getItem(OWNER_KEY) ?? "",
  };
}

export function setBridgeConfig(c: Partial<BridgeConfig>): BridgeConfig {
  if (c.autoStart !== undefined) localStorage.setItem(AUTO_KEY, c.autoStart ? "1" : "0");
  if (c.ownerNumber !== undefined) localStorage.setItem(OWNER_KEY, c.ownerNumber.trim());
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
  return invoke<BridgeState>("wa_bridge_start");
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

/** Incoming WhatsApp message (routed from the sidecar through Rust). */
export interface WaMessage {
  id: string;
  from: string;
  text: string;
  fromName?: string;
}

export function onWaMessage(cb: (m: WaMessage) => void): () => void {
  if (!hasDesktop) return () => {};
  const un = listen<WaMessage>("wa-message", (e) => cb(e.payload));
  return () => void un.then((f) => f()).catch(() => {});
}

/** Answer an incoming message — this is the local agent's reply channel. */
export async function replyWa(id: string, text: string): Promise<void> {
  if (!hasDesktop) return;
  await invoke("wa_bridge_reply", { id, text });
}

/** Send a proactive message to a specific JID (owner notifications). */
export async function sendWa(to: string, text: string): Promise<void> {
  if (!hasDesktop) return;
  await invoke("wa_bridge_send", { to, text });
}

/** Called once at boot: if the owner asked for it, bring WhatsApp up in the
 *  background so the app simply has a live channel after launch. Silent by
 *  design — a failure here must never block startup. */
export async function autoStartBridge(): Promise<void> {
  if (!hasDesktop) return;
  const { autoStart } = getBridgeConfig();
  if (!autoStart) return;
  try {
    await startBridge();
  } catch (e) {
    console.warn("WhatsApp bridge auto-start failed:", e);
  }
}
