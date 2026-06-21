/* Automated agent tasks ("cron"). A task pairs a natural-language goal with a
 * schedule; the in-app scheduler (components/AgentScheduler) runs the goal via
 * aiAutonomous when due.
 *
 * ponytail: in-app scheduler — tasks fire only while the desktop app is open,
 * with minute-granularity preset schedules (not a full cron parser). Upgrade
 * path if needed: OS-level scheduling via Tauri autostart + a background worker,
 * and a real cron expression.
 */

export type Schedule =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string } // "HH:MM" 24h, local
  | { type: "weekly"; day: number; time: string }; // day 0=Sun…6=Sat

export interface AgentTask {
  id: string;
  name: string;
  goal: string;
  schedule: Schedule;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  lastError?: string;
}

const KEY = "filey.agent.tasks";

export function loadTasks(): AgentTask[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as AgentTask[]) : [];
  } catch {
    console.error("Failed to parse agent tasks");
    return [];
  }
}

export function saveTasks(tasks: AgentTask[]): void {
  localStorage.setItem(KEY, JSON.stringify(tasks));
}

export function addTask(
  t: Omit<AgentTask, "id" | "createdAt" | "enabled"> & { enabled?: boolean }
): AgentTask {
  const task: AgentTask = {
    id: `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    createdAt: Date.now(),
    enabled: t.enabled ?? true,
    name: t.name,
    goal: t.goal,
    schedule: t.schedule,
  };
  saveTasks([...loadTasks(), task]);
  return task;
}

export function updateTask(id: string, patch: Partial<AgentTask>): void {
  saveTasks(loadTasks().map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function removeTask(id: string): void {
  saveTasks(loadTasks().filter((t) => t.id !== id));
}

/** Is the task due to run now? Time-based schedules fire once per occurrence. */
export function isDue(task: AgentTask, now = Date.now()): boolean {
  if (!task.enabled) return false;
  const s = task.schedule;
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
    new Date(now).getDay() === s.day &&
    now >= targetTs &&
    (task.lastRun ?? 0) < targetTs
  );
}

/** Human-readable schedule, e.g. "Every 30 min" / "Daily 09:00" / "Mon 08:30". */
export function describeSchedule(s: Schedule): string {
  if (s.type === "interval") {
    const m = s.minutes;
    if (m % 60 === 0) return `Every ${m / 60} h`;
    return `Every ${m} min`;
  }
  if (s.type === "daily") return `Daily ${s.time}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[s.day] ?? "?"} ${s.time}`;
}
