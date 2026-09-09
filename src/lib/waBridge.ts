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
import { log } from "./log";
import { listen } from "@tauri-apps/api/event";
import { getCacheScope } from "./api";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";

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
const ACCOUNT_KEY = "filey.wa_bridge.account";

/** Pairing belongs to an account and organization across its storage modes. */
function accountScope(): string | null {
  return agentStorageScope() ? getCacheScope() : null;
}

function boundAccount(): string {
  const account = accountScope();
  if (!account) throw new Error("Sign in to Filey before connecting WhatsApp.");
  const bound = localStorage.getItem(ACCOUNT_KEY);
  if (bound !== account)
    throw new Error(
      bound
        ? "WhatsApp belongs to another Filey account. Use Re-pair in Integrations to connect your own phone."
        : "Connect WhatsApp once in Integrations to link the existing pairing to this Filey account."
    );
  return account;
}

function visibleState(state: BridgeState): BridgeState {
  try {
    boundAccount();
    return state;
  } catch (e) {
    return { state: "stopped", error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BridgeConfig {
  /** Start with the app, so WhatsApp is simply live after launch. */
  autoStart: boolean;
  /** The number the agent takes orders from, when it isn't the paired account
   *  itself — pair a spare SIM as the bot and this is your own phone. Empty
   *  means self-chat only. */
  ownerNumber: string;
}

export function getBridgeConfig(): BridgeConfig {
  const account = accountScope();
  const suffix = account ? `:${encodeURIComponent(account)}` : "";
  return {
    autoStart:
      !!account &&
      localStorage.getItem(ACCOUNT_KEY) === account &&
      (localStorage.getItem(AUTO_KEY + suffix) ?? localStorage.getItem(AUTO_KEY)) !== "0",
    ownerNumber: account ? (localStorage.getItem(OWNER_KEY + suffix) ?? "") : "",
  };
}

export function setBridgeConfig(c: Partial<BridgeConfig>): BridgeConfig {
  const account = accountScope();
  if (!account) throw new Error("Sign in to Filey before changing WhatsApp preferences.");
  const suffix = `:${encodeURIComponent(account)}`;
  if (c.autoStart !== undefined)
    localStorage.setItem(AUTO_KEY + suffix, c.autoStart ? "1" : "0");
  if (c.ownerNumber !== undefined)
    localStorage.setItem(OWNER_KEY + suffix, c.ownerNumber.trim());
  return getBridgeConfig();
}

export async function bridgeState(): Promise<BridgeState> {
  if (!hasDesktop) return { state: "stopped" };
  try {
    return visibleState(await invoke<BridgeState>("wa_bridge_state"));
  } catch (e) {
    return {
      state: "error",
      error: `Could not read WhatsApp connection status: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function startBridge(): Promise<BridgeState> {
  if (!hasDesktop) throw new Error("The WhatsApp bridge runs in the desktop app only.");
  const account = accountScope();
  if (!account) throw new Error("Sign in to Filey before connecting WhatsApp.");
  const previous = localStorage.getItem(ACCOUNT_KEY);
  if (previous && previous !== account) boundAccount();
  const state = await invoke<BridgeState>("wa_bridge_start");
  if (account !== accountScope()) {
    await stopBridge();
    throw new Error(
      "Your Filey account changed while connecting WhatsApp. Connect again in Integrations."
    );
  }
  localStorage.setItem(ACCOUNT_KEY, account);
  return state;
}

/** Wipe the pairing and start again (next start shows a QR). The way out of a
 *  session the phone can no longer decrypt — see wa_bridge_reset. */
export async function resetBridge(): Promise<BridgeState> {
  if (!hasDesktop) throw new Error("The WhatsApp bridge runs in the desktop app only.");
  const account = accountScope();
  if (!account) throw new Error("Sign in to Filey before connecting WhatsApp.");
  const state = await invoke<BridgeState>("wa_bridge_reset");
  if (account !== accountScope()) {
    await stopBridge();
    throw new Error(
      "Your Filey account changed while pairing WhatsApp. Connect again in Integrations."
    );
  }
  localStorage.setItem(ACCOUNT_KEY, account);
  return state;
}

export async function stopBridge(): Promise<void> {
  if (!hasDesktop) return;
  await invoke("wa_bridge_stop");
}

/** Live state pushed from the supervisor (QR arriving, connection opening). */
export function onBridgeState(cb: (s: BridgeState) => void): () => void {
  if (!hasDesktop) return () => {};
  const un = listen<BridgeState>("wa-bridge", (e) => cb(visibleState(e.payload)));
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
  if (!hasDesktop) return () => void 0;
  const un = listen<WaMessage>("wa-message", (e) => cb(e.payload));
  return () => void un.then((f) => f()).catch(() => {});
}

/** A voice note the owner sent — audio arrives base64; the app transcribes it
 *  and feeds the words to the agent exactly like a typed message. */
export interface WaVoice {
  id: string;
  from: string;
  text: string; // unused for voice (kept for shape parity)
  fromName?: string;
  b64: string;
  mimetype?: string;
}

export function onWaVoice(cb: (v: WaVoice) => void): () => void {
  if (!hasDesktop) return () => void 0;
  const un = listen<WaVoice>("wa-voice", (e) => cb(e.payload));
  return () => void un.then((f) => f()).catch(() => {});
}

/** Answer an incoming message — this is the local agent's reply channel. */
export async function replyWa(id: string, text: string): Promise<void> {
  if (!hasDesktop) throw new Error("The WhatsApp bridge runs in the desktop app only.");
  boundAccount();
  await invoke("wa_bridge_reply", { id, text });
}

/** Send a proactive message to a specific JID (owner notifications). */
export async function sendWa(to: string, text: string): Promise<void> {
  if (!hasDesktop) throw new Error("The WhatsApp bridge runs in the desktop app only.");
  boundAccount();
  await invoke("wa_bridge_send", { to, text });
}

/** Send a file (PDF, photo, document) to a JID. The desktop sidecar reads it
 *  off disk and uploads it — images go as photos, everything else as
 *  documents. Throws when the bridge is down or the file is missing. */
export async function sendWaFile(
  to: string,
  file: { path: string; filename: string; mimetype?: string; caption?: string }
): Promise<void> {
  if (!hasDesktop)
    throw new Error("Sending files over WhatsApp runs in the desktop app only.");
  boundAccount();
  await invoke("wa_bridge_send_file", {
    to,
    path: file.path,
    filename: file.filename,
    mimetype: file.mimetype ?? "",
    caption: file.caption ?? "",
  });
}

/** Called once at boot: if the owner asked for it, bring WhatsApp up in the
 *  background so the app simply has a live channel after launch. Silent by
 *  design — a failure here must never block startup. */
let watchingAccount = false;
let lastAccount: string | null | undefined;
let autoQueue = Promise.resolve();

export async function autoStartBridge(): Promise<void> {
  if (!hasDesktop) return;
  if (!watchingAccount) {
    watchingAccount = true;
    window.addEventListener(AGENT_STORAGE_EVENT, () => void autoStartBridge());
    window.addEventListener("storage", () => void autoStartBridge());
  }
  const account = accountScope();
  if (account === lastAccount) return autoQueue;
  const previous = lastAccount;
  lastAccount = account;
  autoQueue = autoQueue
    .then(async () => {
      if (account !== accountScope()) return;
      if (
        (previous && previous !== account) ||
        (localStorage.getItem(ACCOUNT_KEY) &&
          localStorage.getItem(ACCOUNT_KEY) !== account)
      )
        await stopBridge();
      if (!account || !getBridgeConfig().autoStart || account !== accountScope()) return;
      // Auto-start resumes a binding; it never claims an unbound pairing.
      boundAccount();
      await invoke<BridgeState>("wa_bridge_start");
      if (account !== accountScope()) await stopBridge();
    })
    .catch((e) => log.warn("whatsapp", "bridge auto-start failed", e));
  return autoQueue;
}
