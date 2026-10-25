/* Automated agent tasks. A task pairs a natural-language goal with a schedule,
 * business events to watch, or both; the scheduler (components/AgentScheduler)
 * runs the goal via aiAutonomous when due or when a watched event happens.
 *
 * Filey stays running in the tray after its window closes (lib/alwaysOn), so
 * tasks keep firing until the owner quits from the tray. Schedules are presets
 * at minute granularity, not a full cron parser.
 */

import { readAgentStorage, writeAgentStorage } from "./agentStorage";

export type Schedule =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string } // "HH:MM" 24h, local
  | { type: "weekly"; day: number; time: string } // day 0=Sun…6=Sat
  /** No clock: runs only when a watched business event happens. */
  | { type: "events" };

/** Business events a task can watch. Found by lib/agentWatches every 15 min. */
export type WatchEvent = "invoice_overdue" | "invoice_paid" | "stock_low" | "follow_up_due";
export const WATCH_EVENTS: Record<WatchEvent, string> = {
  invoice_overdue: "an invoice becomes overdue",
  invoice_paid: "an invoice is paid",
  stock_low: "a product runs low",
  follow_up_due: "a follow-up comes due",
};
export const isWatchEvent = (value: unknown): value is WatchEvent =>
  typeof value === "string" && value in WATCH_EVENTS;

export interface AgentTask {
  id: string;
  name: string;
  goal: string;
  schedule: Schedule;
  /** Watched business events; each new one runs the goal with the details. */
  on?: WatchEvent[];
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  lastError?: string;
  /** Set while a background run is in progress; left behind if Filey closed mid-run. */
  runningSince?: number;
  /** A run was cut off. It waits for the owner to check and press Retry. */
  interrupted?: boolean;
  /** Newest watched event already handed to this task. */
  lastEventAt?: number;
}

const KEY = "filey.agent.tasks";

export function loadTasks(): AgentTask[] {
  try {
    const raw = readAgentStorage(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as AgentTask[]) : [];
  } catch {
    console.error("Failed to parse agent tasks");
    return [];
  }
}

export function saveTasks(tasks: AgentTask[]): void {
  writeAgentStorage(KEY, JSON.stringify(tasks));
}

export function addTask(
  t: Pick<AgentTask, "name" | "goal" | "schedule"> & { on?: WatchEvent[]; enabled?: boolean }
): AgentTask {
  const on = [...new Set((t.on ?? []).filter(isWatchEvent))];
  if (t.schedule.type === "events" && !on.length)
    throw new Error("Pick at least one thing to watch, or give the automation a schedule.");
  const task: AgentTask = {
    id: `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    createdAt: Date.now(),
    enabled: t.enabled ?? true,
    name: t.name,
    goal: t.goal,
    schedule: t.schedule,
    ...(on.length ? { on } : {}),
  };
  saveTasks([...loadTasks(), task]);
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<AgentTask>,
  expectedScope?: string
): void {
  writeAgentStorage(
    KEY,
    JSON.stringify(loadTasks().map((t) => (t.id === id ? { ...t, ...patch } : t))),
    expectedScope
  );
}

export function removeTask(id: string): void {
  saveTasks(loadTasks().filter((t) => t.id !== id));
}

/** Is the task due to run now? Time-based schedules fire once per occurrence. */
export function isDue(task: AgentTask, now = Date.now()): boolean {
  if (!task.enabled || task.interrupted) return false;
  const s = task.schedule;
  if (s.type === "events") return false;
  if (s.type === "interval") {
    const base = task.lastRun ?? task.createdAt;
    return now - base >= Math.max(1, s.minutes) * 60_000;
  }
  const [h, m] = s.time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h || 0, m || 0, 0, 0);
  const targetTs = target.getTime();
  if (s.type === "daily") {
    return now >= targetTs && (task.lastRun ?? 0) < targetTs;
  }
  // weekly: only on the chosen weekday, after the target time, once that day
  return (
    new Date(now).getDay() === s.day && now >= targetTs && (task.lastRun ?? 0) < targetTs
  );
}

/** Human-readable schedule, e.g. "Every 30 min" / "Daily 09:00" / "Mon 08:30". */
export function describeSchedule(s: Schedule): string {
  if (s.type === "events") return "When something happens";
  if (s.type === "interval") {
    const m = s.minutes;
    if (m % 60 === 0) return `Every ${m / 60} h`;
    return `Every ${m} min`;
  }
  if (s.type === "daily") return `Daily ${s.time}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[s.day] ?? "?"} ${s.time}`;
}

/** Schedule plus watched events, e.g. "Daily 09:00 · when a product runs low". */
export function describeTrigger(task: Pick<AgentTask, "schedule" | "on">): string {
  const watch = (task.on ?? []).filter(isWatchEvent).map(kind => WATCH_EVENTS[kind]);
  const when = watch.length ? `when ${watch.map(text => text.replace(/^an? /, "")).join(", ")}` : "";
  if (task.schedule.type === "events") return when || "Never (nothing to watch)";
  return [describeSchedule(task.schedule), when].filter(Boolean).join(" · ");
}
