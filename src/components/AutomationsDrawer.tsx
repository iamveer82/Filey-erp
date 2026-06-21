import { useEffect, useRef, useState } from "react";
import { X, Plus, Play, Trash2, Loader2, Timer, AlertTriangle } from "lucide-react";
import {
  loadTasks,
  addTask,
  updateTask,
  removeTask,
  describeSchedule,
  type AgentTask,
  type Schedule,
} from "../lib/agentTasks";
import { aiAutonomous, aiReady } from "../lib/ai";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* Manage scheduled agent tasks. The app-wide AgentScheduler runs them when due;
 * here the user creates, toggles, runs-now and deletes them. */
export default function AutomationsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ui = useUI();
  const toastRef = useRef(ui.toast);
  toastRef.current = ui.toast;

  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  // create form
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [type, setType] = useState<Schedule["type"]>("daily");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(1);

  const refresh = () => setTasks(loadTasks());
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  const buildSchedule = (): Schedule => {
    if (type === "interval") return { type, minutes: Math.max(1, minutes) };
    if (type === "weekly") return { type, day, time };
    return { type: "daily", time };
  };

  const create = () => {
    if (!goal.trim()) {
      toastRef.current?.error("Describe what the automation should do.");
      return;
    }
    addTask({
      name: name.trim() || goal.trim().slice(0, 40),
      goal: goal.trim(),
      schedule: buildSchedule(),
    });
    setName("");
    setGoal("");
    refresh();
    toastRef.current?.success("Automation added");
  };

  const runNow = async (t: AgentTask) => {
    if (!aiReady()) {
      toastRef.current?.error("Connect a model first (Settings → AI Assistant).");
      return;
    }
    setRunning(t.id);
    try {
      const summary = await aiAutonomous(t.goal, { maxRounds: 15 });
      updateTask(t.id, { lastRun: Date.now(), lastResult: summary, lastError: undefined });
      toastRef.current?.success(`"${t.name}" ran`);
    } catch (e) {
      updateTask(t.id, {
        lastRun: Date.now(),
        lastError: e instanceof Error ? e.message : String(e),
      });
      toastRef.current?.error(`"${t.name}" failed`);
    } finally {
      setRunning(null);
      refresh();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 flex h-full w-[26rem] max-w-[90vw] flex-col bg-white shadow-bento dark:bg-[#1A1B1E]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3 dark:border-[#3A3D45]">
          <div className="flex items-center gap-2">
            <Timer size={18} className="text-primary-500" />
            <p className="font-semibold text-ink">Automations</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-brand-400 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {/* Create */}
          <div className="rounded-2xl border border-brand-200 p-3 dark:border-[#3A3D45]">
            <p className="label">New automation</p>
            <input
              className="input mb-2"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="textarea mb-2 min-h-[64px]"
              placeholder="What should the agent do? e.g. 'Email me a summary of today's overdue invoices'"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="select w-auto"
                value={type}
                onChange={(e) => setType(e.target.value as Schedule["type"])}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="interval">Every…</option>
              </select>
              {type === "interval" ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    className="input w-20"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value) || 60)}
                  />
                  <span className="text-sm text-brand-500">min</span>
                </span>
              ) : (
                <>
                  {type === "weekly" && (
                    <select
                      className="select w-auto"
                      value={day}
                      onChange={(e) => setDay(Number(e.target.value))}
                    >
                      {DAYS.map((d, i) => (
                        <option key={i} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="time"
                    className="input w-32"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </>
              )}
              <button className="btn-primary ml-auto h-9 px-3 text-sm" onClick={create}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* List */}
          <div className="mt-4 space-y-2">
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-brand-500">
                No automations yet. Create one above — it runs while the app is open.
              </p>
            ) : (
              tasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl border border-brand-200 p-3 dark:border-[#3A3D45]"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{t.name}</p>
                      <p className="truncate text-xs text-brand-400">{t.goal}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary-600">
                        <Timer size={11} /> {describeSchedule(t.schedule)}
                        {t.lastRun && (
                          <span className="text-brand-400">
                            {" "}
                            · last {new Date(t.lastRun).toLocaleString()}
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        updateTask(t.id, { enabled: !t.enabled });
                        refresh();
                      }}
                      title={t.enabled ? "Enabled — click to pause" : "Paused — click to enable"}
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                        t.enabled ? "bg-primary-400" : "bg-brand-300 dark:bg-[#3A3D45]"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                          t.enabled ? "left-[18px]" : "left-0.5"
                        )}
                      />
                    </button>
                  </div>
                  {t.lastError && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-danger">
                      <AlertTriangle size={11} /> {t.lastError}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => runNow(t)}
                      disabled={running === t.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:border-[#3A3D45] dark:text-[#DDE0E4] dark:hover:bg-white/10"
                    >
                      {running === t.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      Run now
                    </button>
                    <button
                      onClick={() => {
                        removeTask(t.id);
                        refresh();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-400 hover:text-danger"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="border-t border-brand-200 px-4 py-2.5 text-[11px] text-brand-400 dark:border-[#3A3D45]">
          Automations run while Filey is open. Sensitive actions (send/pay) still
          ask for approval — best for summaries & reports.
        </p>
      </div>
    </div>
  );
}
