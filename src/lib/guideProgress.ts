import { agentStorageScope } from "./agentStorage";

type GuideProgress = { step: number; finished: boolean };
type ProgressStore = Record<string, GuideProgress>;
const PREFIX = "filey.guides.v1:";
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

function validGuideId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value) && !RESERVED.has(value);
}

function validProgress(value: unknown): value is GuideProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  return keys.length === 2 && keys.every(key => key === "step" || key === "finished") && Number.isInteger(item.step)
    && typeof item.step === "number" && item.step >= 0 && item.step <= 100 && typeof item.finished === "boolean";
}

function parse(raw: string | null): ProgressStore | null {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const clean: ProgressStore = {};
    for (const [id, progress] of Object.entries(value)) {
      if (!validGuideId(id) || !validProgress(progress)) return null;
      clean[id] = { step: progress.step, finished: progress.finished };
    }
    return clean;
  } catch {
    return null;
  }
}

/** Guide position stays on this device, separate for each account/workspace/mode. */
export function loadGuideProgress(scope: string | null): ProgressStore {
  try {
    if (!scope || scope !== agentStorageScope()) return {};
    return parse(localStorage.getItem(PREFIX + encodeURIComponent(scope))) ?? {};
  } catch {
    return {};
  }
}

/** A failed read or corrupt source must never be replaced by an empty store. */
export function saveGuideProgress(scope: string | null, guideId: string, progress: GuideProgress): boolean {
  try {
    if (!scope || scope !== agentStorageScope() || !validGuideId(guideId) || !validProgress(progress)) return false;
    const key = PREFIX + encodeURIComponent(scope);
    const saved = parse(localStorage.getItem(key));
    if (saved === null || scope !== agentStorageScope()) return false;
    saved[guideId] = { step: progress.step, finished: progress.finished };
    localStorage.setItem(key, JSON.stringify(saved));
    return true;
  } catch {
    // Storage errors can contain private source text. The caller gets only a
    // failure signal and decides how to present a generic retry message.
    return false;
  }
}
