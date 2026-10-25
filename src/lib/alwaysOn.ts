/* Always-on agent: Filey keeps working after its window closes.
 *
 * The desktop host (src-tauri/src/modules/always_on.rs) hides the window
 * instead of quitting, owns the tray (Open / Pause agent / Quit) and sends a
 * native tick every 30 s. A hidden page's own timers are slowed by the
 * browser engine; the tick is not, so schedules and watches stay on time.
 *
 * The tick costs nothing by itself: the scheduler only calls a model when an
 * automation is due or a watched business event happened, and a daily cap
 * bounds what a runaway watch could spend. Pausing stops automations, watches
 * and the hourly check; chats on WhatsApp/Telegram are still answered.
 *
 * These are device settings (this computer's tray and window), not account data. */
import { hasTauri } from "./localPaths";
import { localYmd } from "./format";

export const HEARTBEAT_EVENT = "filey:heartbeat";
export const ALWAYS_ON_EVENT = "filey:always-on";
const SETTINGS_KEY = "filey.alwaysOn";
const BUDGET_KEY = "filey.alwaysOn.budget";
const TOLD_KEY = "filey.alwaysOn.toldTray";
/** Background agent runs per day on this computer (automations + watches). */
export const DAILY_RUN_LIMIT = 40;

export interface AlwaysOnSettings {
  /** Closing the window hides Filey to the tray instead of quitting. */
  keepRunning: boolean;
  /** Background agent work is on hold. */
  paused: boolean;
}

const DEFAULTS: AlwaysOnSettings = { keepRunning: true, paused: false };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: keep running on defaults */ }
}

export function alwaysOnSettings(): AlwaysOnSettings {
  const saved = read<AlwaysOnSettings>(SETTINGS_KEY, DEFAULTS);
  return { keepRunning: saved.keepRunning !== false, paused: saved.paused === true };
}

export const alwaysOnPaused = (): boolean => alwaysOnSettings().paused;

async function tellHost(settings: AlwaysOnSettings): Promise<void> {
  if (!hasTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("always_on_configure", { keepRunning: settings.keepRunning, paused: settings.paused });
}

export async function setAlwaysOn(patch: Partial<AlwaysOnSettings>): Promise<AlwaysOnSettings> {
  const next = { ...alwaysOnSettings(), ...patch };
  write(SETTINGS_KEY, next);
  window.dispatchEvent(new CustomEvent(ALWAYS_ON_EVENT, { detail: next }));
  await tellHost(next).catch(error => console.warn("Always-on settings did not reach the desktop host.", error));
  return next;
}

/** Take one background run from today's allowance. False once it is used up. */
export function takeBackgroundRun(now = new Date()): boolean {
  const day = localYmd(now);
  const budget = read<{ day: string; runs: number }>(BUDGET_KEY, { day, runs: 0 });
  const runs = budget.day === day ? budget.runs : 0;
  if (runs >= DAILY_RUN_LIMIT) return false;
  write(BUDGET_KEY, { day, runs: runs + 1 });
  return true;
}

export function backgroundRunsToday(now = new Date()): number {
  const day = localYmd(now);
  const budget = read<{ day: string; runs: number }>(BUDGET_KEY, { day, runs: 0 });
  return budget.day === day ? budget.runs : 0;
}

/** A desktop notification, only when the owner is not already looking at Filey. */
export async function notifyOwner(title: string, body: string): Promise<void> {
  if (!hasTauri) return;
  if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("always_on_notify", { title, body });
  } catch (error) {
    console.warn("Desktop notification failed.", error);
  }
}

export async function showFiley(): Promise<void> {
  if (!hasTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("always_on_show").catch(() => undefined);
}

let started = false;

/** Mount once at boot on the desktop app. */
export async function startAlwaysOn(): Promise<void> {
  if (started || !hasTauri) return;
  started = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen("filey://tick", () => window.dispatchEvent(new Event(HEARTBEAT_EVENT)));
  await listen<{ paused?: boolean }>("filey://always-on", event => {
    if (typeof event.payload?.paused === "boolean") void setAlwaysOn({ paused: event.payload.paused });
  });
  await listen("filey://hidden", () => {
    if (read<{ told: boolean }>(TOLD_KEY, { told: false }).told) return;
    write(TOLD_KEY, { told: true });
    void notifyOwner("Filey is still running", "The agent keeps working in the tray. Right-click the Filey icon there to quit.");
  });
  await tellHost(alwaysOnSettings()).catch(error => console.warn("Always-on settings did not reach the desktop host.", error));
}
