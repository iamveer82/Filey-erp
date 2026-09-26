import { invoke } from "@tauri-apps/api/core";
import { getCacheScope } from "./api";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";
import { requireModuleAccess } from "./moduleAccess";
import { isToolAllowed } from "./capabilities";

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  window_id: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  blockedPopupUrl?: string | null;
  warning?: string | null;
}
export interface DesktopBrowserResult { tabs: BrowserTab[]; tab?: BrowserTab | null }
export interface BrowserPanelState { open: boolean; tabs: BrowserTab[]; activeId: string | null; agentId: string | null; paused: boolean }
let panel: BrowserPanelState = { open: false, tabs: [], activeId: null, agentId: null, paused: false };
const panelListeners = new Set<() => void>();
let syncViewport: (() => Promise<void>) | null = null;
export const getBrowserPanelState = () => panel;
export function subscribeBrowserPanel(listener: () => void) { panelListeners.add(listener); return () => { panelListeners.delete(listener); }; }
function updatePanel(next: BrowserPanelState) { panel = next; panelListeners.forEach(listener => listener()); }
export function setBrowserPanelOpen(open: boolean) { if (open !== panel.open) updatePanel({ ...panel, open }); }
export function newBrowserPanelTab() { updatePanel({ ...panel, open: true, activeId: null }); }
let selection = 0;
/** A conversation owns its cookies/profile; switching closes views, not data. */
export async function selectAgentBrowser(agentId: string | null) {
  if (agentId && !isToolAllowed("agent_computer")) throw new Error("Agent computers are off. Enable them in Filey AI's action groups first.");
  if (agentId === panel.agentId) return;
  const next = ++selection;
  const { disableComputerUse } = await import("./computerUse");
  if (next !== selection) throw new DOMException("Browser selection changed", "AbortError");
  await disableComputerUse();
  if (next !== selection) throw new DOMException("Browser selection changed", "AbortError");
  await closeDesktopBrowserTabs();
  if (next !== selection) throw new DOMException("Browser selection changed", "AbortError");
  if (agentId && !isToolAllowed("agent_computer")) throw new DOMException("Agent computers turned off", "AbortError");
  updatePanel({ ...panel, agentId, paused: false });
}
export async function pauseAgentBrowser(paused: boolean) {
  updatePanel({ ...panel, paused });
  if (paused) { const { disableComputerUse } = await import("./computerUse"); await disableComputerUse(); }
}
const profileIdentity = (account: string) => panel.agentId ? JSON.stringify([account, panel.agentId]) : account;
export function registerBrowserViewportSync(sync: () => Promise<void>) {
  syncViewport = sync;
  return () => { if (syncViewport === sync) syncViewport = null; };
}

export interface BrowserBounds { x: number; y: number; width: number; height: number }
let layoutQueue: Promise<void> = Promise.resolve();
export function layoutDesktopBrowser(bounds: BrowserBounds | null, tabId: string | null): Promise<void> {
  if (!desktopBrowserSupported()) return Promise.resolve();
  const scope = agentStorageScope();
  const account = getCacheScope();
  if (!scope || !account) return Promise.resolve();
  const version = generation;
  // Serialize native positioning so a slow show cannot overtake a collapse.
  // This queue stays separate from commands, which await viewport readiness.
  const result = layoutQueue.then(async () => {
    if (scope !== agentStorageScope() || version !== generation) return;
    const profile = await profileKey(profileIdentity(account));
    if (scope !== agentStorageScope() || version !== generation) return;
    if (bounds && (!Object.values(bounds).every(Number.isFinite) || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1)) throw new Error("Invalid browser panel bounds.");
    if (bounds) await requireModuleAccess("browser", true);
    if (scope !== agentStorageScope() || version !== generation) return;
    await invoke("desktop_browser_layout", { profile, bounds, tabId });
  });
  layoutQueue = result.catch(() => {});
  return result;
}
export interface DesktopBrowserRequest {
  action: "open" | "list" | "navigate" | "back" | "forward" | "reload" | "stop" | "focus" | "close" | "close_all";
  url?: string;
  tab_id?: string;
}

let generation = 0;
let activeScope: string | null = null;
let activeProfile: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
let profileCache: { account: string; digest: Promise<string> } | null = null;

export function desktopBrowserSupported(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    && typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent);
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}

/** Stable per account/company, deliberately shared across local/cloud mode.
 * The native profile component contains no account names, emails or paths. */
function profileKey(account: string): Promise<string> {
  if (profileCache?.account !== account) {
    profileCache = { account, digest: crypto.subtle.digest("SHA-256", new TextEncoder().encode(account))
      .then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")) };
  }
  return profileCache.digest;
}

function validate(args: DesktopBrowserRequest | Record<string, unknown>): DesktopBrowserRequest {
  const action = args.action;
  if (action === "list" || action === "close_all") return { action };
  if (!["open", "navigate", "back", "forward", "reload", "stop", "focus", "close"].includes(String(action)))
    throw new Error("Unsupported browser action.");
  const result = { action } as DesktopBrowserRequest;
  if (action !== "open") {
    if (typeof args.tab_id !== "string" || !/^filey-browser-[a-f0-9-]{36}$/.test(args.tab_id))
      throw new Error("Choose an open Filey browser tab.");
    result.tab_id = args.tab_id;
  }
  if (action === "open" || action === "navigate") {
    if (typeof args.url !== "string" || !args.url || args.url.length > 65_536
      || [...args.url].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
      throw new Error("Enter an HTTPS URL of at most 65,536 characters.");
    let url: URL;
    try { url = new URL(args.url); } catch { throw new Error("Enter a complete HTTPS URL."); }
    if (url.href.length > 65_536) throw new Error("The encoded URL exceeds 65,536 characters.");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!url.hostname || url.username || url.password || url.hostname.endsWith(".localhost")
      || local && url.port === "1420" || url.protocol !== "https:" && !(url.protocol === "http:" && local))
      throw new Error("Use HTTPS, or HTTP on localhost. Filey origins, credentials and custom schemes are not allowed.");
    result.url = url.href;
  }
  return result;
}

/** Closing tabs leaves the per-account browsing profile intact. */
export function closeDesktopBrowserTabs(): Promise<void> {
  generation++;
  updatePanel({ ...panel, open: false, tabs: [], activeId: null, paused: false });
  const profile = activeProfile;
  activeProfile = null;
  activeScope = null;
  // Do not wait behind a slow page/window open before revoking its reservation.
  const closing = profile
    ? invoke<void>("desktop_browser_command", { profile, request: { action: "close_all" } })
    : Promise.resolve();
  queue = Promise.allSettled([queue, closing]);
  return closing;
}

/** Explicit browser management only. DOM extraction, eval, cookies and login
 * credentials are not exposed. Observation/input use computer_use separately. */
export async function desktopBrowserCommand(
  args: DesktopBrowserRequest | Record<string, unknown>, signal?: AbortSignal, agentId?: string,
): Promise<DesktopBrowserResult> {
  if (!desktopBrowserSupported()) throw new Error("Filey's built-in browser requires the Windows desktop app.");
  const request = validate(args);
  if (agentId !== undefined) {
    if (panel.paused) throw new Error("The user has control of the browser. Wait for them to resume the agent.");
    if (panel.agentId !== agentId) {
      if (panel.tabs.length) throw new Error("Another conversation is using the browser. Stop it before opening this agent's workspace.");
      await selectAgentBrowser(agentId);
    }
  }
  const scope = agentStorageScope();
  const account = getCacheScope();
  if (!scope || !account) throw new Error("Sign in to this workspace before using Filey Browser.");
  const version = generation;
  const profile = await profileKey(profileIdentity(account));
  return enqueue(async () => {
    if (!["close","close_all","stop"].includes(request.action)) await requireModuleAccess("browser", true);
    if (signal?.aborted || version !== generation || scope !== agentStorageScope())
      throw new DOMException("Browser action canceled or workspace changed", "AbortError");
    if (agentId !== undefined && (!isToolAllowed("agent_computer") || panel.paused || panel.agentId !== agentId))
      throw new DOMException("Browser control changed", "AbortError");
    activeScope = scope;
    activeProfile = profile;
    if (request.action === "open" || request.action === "focus") setBrowserPanelOpen(true);
    const abort = () => { if (request.action !== "list") void closeDesktopBrowserTabs().catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await invoke<DesktopBrowserResult>("desktop_browser_command", { profile, request });
      if (signal?.aborted || version !== generation || scope !== agentStorageScope()) {
        if (request.action !== "list" || version !== generation || scope !== agentStorageScope())
          await invoke("desktop_browser_command", { profile, request: { action: "close_all" } });
        throw new DOMException("Browser action canceled or workspace changed", "AbortError");
      }
      if (!result || !Array.isArray(result.tabs) || result.tabs.length > 8)
        throw new Error("Filey Browser returned an invalid response.");
      updatePanel({ ...panel, tabs: result.tabs, activeId: result.tab?.id ?? (panel.activeId === null || result.tabs.some(tab => tab.id === panel.activeId) ? panel.activeId : result.tabs[0]?.id ?? null) });
      if (request.action !== "list") await syncViewport?.();
      return result;
    } finally { signal?.removeEventListener("abort", abort); }
  });
}

if (typeof window !== "undefined") {
  const close = () => { void closeDesktopBrowserTabs().catch(() => {}); };
  window.addEventListener("pagehide", close);
  window.addEventListener("beforeunload", close);
  window.addEventListener("filey:workspace-changed", close);
  window.addEventListener(AGENT_STORAGE_EVENT, () => {
    if (activeScope && activeScope !== agentStorageScope()) close();
    if (panel.agentId && !isToolAllowed("agent_computer")) {
      close();
      void selectAgentBrowser(null).catch(() => {});
    }
  });
  window.addEventListener("storage", (event) => { if (event.key === null || event.key === "filey_data_mode") close(); });
}
