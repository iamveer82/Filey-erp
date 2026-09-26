import { invoke } from "@tauri-apps/api/core";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";
import { requireModuleAccess } from "./moduleAccess";

export interface ComputerUseState { enabled: boolean; expiresAt: number | null; busy: boolean }
type Grant = { sessionToken: string; expiresAt: number | null; scope: string; windowId?: string; browserTab?: string };
let grant: Grant | null = null;
let current: ComputerUseState = { enabled: false, expiresAt: null, busy: false };
let generation = 0;
let starting = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function computerUseSupported(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    && typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent);
}

export function getComputerUseState(): ComputerUseState { return current; }
export function subscribeComputerUse(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(state: ComputerUseState) { current = state; for (const listener of listeners) listener(); }

/** Available by default in the signed-in chat. Actions still pass their approval checks.
 * The token is kept in this module, outside prompts, tool results and storage. */
export async function enableComputerUse(durationSeconds: number | null = null, windowId?: string, browserTab?: string): Promise<number> {
  if (!computerUseSupported()) throw new Error("Computer control requires the Windows desktop app.");
  const scope = agentStorageScope();
  if (!scope) throw new Error("Sign in before enabling computer access.");
  if (durationSeconds !== null && (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 900))
    throw new Error("Choose a computer session between 60 and 900 seconds.");
  if (windowId !== undefined && !/^[1-9]\d{0,19}$/.test(windowId))
    throw new Error("Choose a Filey browser window for this task.");
  if (browserTab && (!windowId || !/^filey-browser-[a-f0-9-]{36}$/.test(browserTab))) throw new Error("Choose a valid browser tab.");
  if (durationSeconds === null && grant?.expiresAt === null && grant.scope === scope && grant.windowId === windowId && grant.browserTab === browserTab)
    return generation;
  if (starting) throw new Error("Computer access is already starting.");
  const stopping = disableComputerUse();
  starting = true;
  const version = ++generation;
  publish({ enabled: false, expiresAt: null, busy: true });
  try {
    await stopping;
    await requireModuleAccess("browser", true);
    if (version !== generation || scope !== agentStorageScope()) throw new Error("Workspace changed before computer access started.");
    const result = await invoke<{ sessionToken: string; expiresAt: number | null }>("computer_start", { durationSeconds, ...(windowId ? { windowId } : {}), ...(browserTab ? { browserTab } : {}) });
    if (!result || typeof result.sessionToken !== "string" || (result.expiresAt !== null && !Number.isFinite(result.expiresAt)))
      throw new Error("The native computer permission response was invalid.");
    if (version !== generation || scope !== agentStorageScope()) {
      await invoke("computer_stop", { sessionToken: result.sessionToken });
      throw new Error("Computer permission was canceled or the workspace changed.");
    }
    grant = { ...result, scope, windowId, browserTab };
    publish({ enabled: true, expiresAt: result.expiresAt, busy: false });
    if (result.expiresAt !== null)
      expiryTimer = setTimeout(() => { void disableComputerUse().catch(() => {}); }, Math.max(0, result.expiresAt - Date.now()));
    return version;
  } finally {
    if (version === generation) { starting = false; if (!grant) publish({ enabled: false, expiresAt: null, busy: false }); }
  }
}

/** Revocation is immediate locally, even if the native acknowledgment fails. */
export async function disableComputerUse(sessionId?: number): Promise<void> {
  if (sessionId !== undefined && sessionId !== generation) return;
  generation++;
  starting = false;
  clearTimeout(expiryTimer);
  const previous = grant;
  grant = null;
  publish({ enabled: false, expiresAt: null, busy: false });
  if (previous) await invoke("computer_stop", { sessionToken: previous.sessionToken });
}

/** A task can act only through its own grant; replacing it ends that task. */
export function computerUseSessionActive(sessionId: number): boolean {
  return generation === sessionId && !!grant && (grant.expiresAt === null || grant.expiresAt > Date.now())
    && grant.scope === agentStorageScope();
}

function validate(args: Record<string, unknown>): Record<string, unknown> {
  const action = args.action;
  if (action === "list_windows") return { action };
  if (action === "screenshot") {
    if (typeof args.window_id !== "string" || !/^\d{1,20}$/.test(args.window_id)) throw new Error("Choose a window_id from list_windows.");
    return { action, window_id: args.window_id };
  }
  if (!["click", "hover", "drag", "type", "key", "scroll"].includes(String(action))) throw new Error("Unsupported computer action.");
  if (typeof args.snapshot_id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(args.snapshot_id)) throw new Error("Take a screenshot before acting.");
  const request: Record<string, unknown> = { action, snapshot_id: args.snapshot_id };
  if (["click", "hover", "drag", "scroll"].includes(String(action))) {
    if (![args.x, args.y].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1600))
      throw new Error("Coordinates must be integer screenshot pixels.");
    request.x = args.x; request.y = args.y;
  }
  if (action === "click") {
    if (args.button !== undefined && args.button !== "left" && args.button !== "right") throw new Error("Choose left or right click.");
    if (args.double_click !== undefined && typeof args.double_click !== "boolean") throw new Error("double_click must be boolean.");
    request.button = args.button ?? "left"; request.double_click = args.double_click ?? false;
  } else if (action === "drag") {
    if (![args.to_x, args.to_y].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1600))
      throw new Error("Drag destination must be integer screenshot pixels.");
    request.to_x = args.to_x; request.to_y = args.to_y;
  } else if (action === "type") {
    if (typeof args.text !== "string" || !args.text || [...args.text].length > 2000
      || [...args.text].some((char) => (char.charCodeAt(0) < 32 && char !== "\n" && char !== "\t") || char.charCodeAt(0) === 127))
      throw new Error("Type 1–2000 characters without control codes.");
    request.text = args.text;
  } else if (action === "key") {
    if (typeof args.key !== "string" || !/^(Enter|Tab|Escape|Backspace|Delete|Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown|Space|F([1-9]|1[0-2])|Ctrl\+[ACVZYS])$/.test(args.key))
      throw new Error("Unsupported key. System and shell-launch shortcuts are not available.");
    request.key = args.key;
  } else if (action === "scroll") {
    if (typeof args.delta !== "number" || !Number.isInteger(args.delta) || args.delta === 0 || Math.abs(args.delta) > 10)
      throw new Error("Scroll delta must be an integer from -10 to 10, excluding zero.");
    request.delta = args.delta;
    if (args.axis !== undefined && args.axis !== "vertical" && args.axis !== "horizontal")
      throw new Error("Choose vertical or horizontal scrolling.");
    request.axis = args.axis ?? "vertical";
  }
  return request;
}

/** Each input uses one fresh native screenshot ID. Abort also revokes the
 * session and kills the fixed helper; it never retries an uncertain action. */
export async function runComputerUse(args: Record<string, unknown>, signal?: AbortSignal, sessionId?: number): Promise<Record<string, unknown>> {
  if (sessionId !== undefined && !computerUseSessionActive(sessionId))
    throw new DOMException("This computer session ended or was replaced.", "AbortError");
  const request = validate(args);
  const permission = grant;
  if (!permission || (permission.expiresAt !== null && permission.expiresAt <= Date.now()) || permission.scope !== agentStorageScope()) {
    await disableComputerUse();
    throw new Error("Computer access is off or expired. Start a new task in Filey AI to use it.");
  }
  if (current.busy) throw new Error("A computer action is running. Wait or stop it before continuing.");
  if (signal?.aborted) { await disableComputerUse(); throw new DOMException("Computer action canceled", "AbortError"); }
  const version = generation;
  const abort = () => { void disableComputerUse(version).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  publish({ ...current, busy: true });
  try {
    try { await requireModuleAccess("browser", true); }
    catch (error) { await disableComputerUse(version); throw error; }
    if (signal?.aborted || generation !== version || permission.scope !== agentStorageScope()) throw new DOMException("Computer action canceled", "AbortError");
    const result = await invoke<Record<string, unknown>>("computer_command", { sessionToken: permission.sessionToken, request });
    if (signal?.aborted || generation !== version) throw new DOMException("Computer action canceled", "AbortError");
    if (permission.scope !== agentStorageScope()) { await disableComputerUse(); throw new Error("Workspace changed. Computer access stopped."); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The native computer response was invalid.");
    if (request.action === "screenshot") {
      const image = result.image as { dataBase64?: unknown; mediaType?: unknown } | undefined;
      if (image?.mediaType !== "image/png" || typeof image.dataBase64 !== "string" || !image.dataBase64.startsWith("iVBORw0KGgo") || image.dataBase64.length > 5_600_000)
        throw new Error("The captured image was invalid or exceeded its size limit.");
    }
    return result;
  } catch (error) {
    if (String(error).includes("Computer action stopped by Escape")) {
      await disableComputerUse(version);
      throw new DOMException("Computer access stopped by Escape", "AbortError");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (generation === version && grant) publish({ enabled: true, expiresAt: grant.expiresAt, busy: false });
  }
}

if (typeof window !== "undefined") {
  const stop = () => { void disableComputerUse().catch(() => {}); };
  window.addEventListener("pagehide", stop);
  window.addEventListener("beforeunload", stop);
  window.addEventListener("filey:workspace-changed", stop);
  window.addEventListener(AGENT_STORAGE_EVENT, () => { if (grant && grant.scope !== agentStorageScope()) stop(); });
  window.addEventListener("storage", (event) => { if (event.key === null || event.key === "filey_data_mode") stop(); });
}
