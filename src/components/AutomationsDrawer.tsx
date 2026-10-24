import { FileySpinner as Loader2 } from "./FileySpinner";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Play, Trash2, Timer, AlertTriangle, Pause, RotateCcw, Radio } from "lucide-react";
import {
  loadTasks,
  addTask,
  updateTask,
  removeTask,
  describeTrigger,
  WATCH_EVENTS,
  type AgentTask,
  type Schedule,
  type WatchEvent,
} from "../lib/agentTasks";
import { fileyAgentEnabled, fileyAgentReply } from "../lib/fileyAgent";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";
import { SelectMenu } from "./ui-menu";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { ALWAYS_ON_EVENT, alwaysOnSettings, backgroundRunsToday, DAILY_RUN_LIMIT, setAlwaysOn } from "../lib/alwaysOn";
import { approvalExpiresAt, approvalRequests, decideApproval, describeRequest, parkForApproval, type ApprovalRequest } from "../lib/agentApprovals";
import { approvalArgs } from "../lib/aiTools";
import ApprovalCard from "./ApprovalCard";
import "../pages/AgentChat.css";
import { hasTauri } from "../lib/localPaths";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One-tap standing jobs that make the agent work ahead of the owner. Sending and paying
 *  still wait under Needs your OK. */
const SUGGESTED: { name: string; goal: string; schedule: Schedule; on?: WatchEvent[] }[] = [
  {
    name: "Morning briefing",
    goal: "Give me a short morning briefing from Filey's records: yesterday's sales and payments received, invoices now overdue, products at or below their reorder level, and today's follow-ups. Use the real numbers; keep it under 150 words.",
    schedule: { type: "daily", time: "08:30" },
  },
  {
    name: "Chase late payers",
    goal: "For each newly overdue invoice, draft a short, polite payment reminder to that customer with the invoice number, amount and due date, ready to send by WhatsApp or email. Prepare the send so it waits for my OK.",
    schedule: { type: "events" },
    on: ["invoice_overdue"],
  },
  {
    name: "Restock watch",
    goal: "When products run low, check recent sales for each and draft purchase orders to their usual suppliers for a sensible quantity. Leave the drafts for me to review.",
    schedule: { type: "events" },
    on: ["stock_low"],
  },
  {
    name: "Follow-up nudges",
    goal: "When a follow-up comes due, look up that customer or supplier's recent invoices, payments and notes, and give me a two-line summary and a suggested next step.",
    schedule: { type: "events" },
    on: ["follow_up_due"],
  },
];
const WATCH_KINDS = Object.keys(WATCH_EVENTS) as WatchEvent[];
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary-400" : "bg-brand-300")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/* Manage the always-on agent: its standing jobs (schedules and watches), the
 * actions waiting for the owner's OK, and whether it keeps working after the
 * window closes. The app-wide AgentScheduler does the running. */
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
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [settings, setSettings] = useState(alwaysOnSettings);
  const [running, setRunning] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const activeRun = useRef<{ scope: string; controller: AbortController } | null>(null);

  // create form
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [type, setType] = useState<Schedule["type"]>("daily");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(1);
  const [watch, setWatch] = useState<WatchEvent[]>([]);

  const refresh = () => {
    setTasks(loadTasks());
    setRequests(approvalRequests());
    setSettings(alwaysOnSettings());
  };
  useEffect(() => {
    if (open) refresh();
    const changed = () => {
      if (activeRun.current && activeRun.current.scope !== agentStorageScope())
        activeRun.current.controller.abort();
      if (open) refresh();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    window.addEventListener("filey:workspace-changed", changed);
    window.addEventListener(ALWAYS_ON_EVENT, changed);
    return () => {
      activeRun.current?.controller.abort();
      window.removeEventListener(AGENT_STORAGE_EVENT, changed);
      window.removeEventListener("filey:workspace-changed", changed);
      window.removeEventListener(ALWAYS_ON_EVENT, changed);
    };
  }, [open]);

  if (!open) return null;

  const pending = requests.filter(r => r.status === "pending");
  const decided = requests.filter(r => r.status !== "pending").slice(-4).reverse();

  const buildSchedule = (): Schedule => {
    if (type === "events") return { type };
    if (type === "interval") return { type, minutes: Math.max(1, minutes) };
    if (type === "weekly") return { type, day, time };
    return { type: "daily", time };
  };

  const create = () => {
    if (!goal.trim()) {
      toastRef.current?.error("Describe what the automation should do.");
      return;
    }
    try {
      addTask({
        name: name.trim() || goal.trim().slice(0, 40),
        goal: goal.trim(),
        schedule: buildSchedule(),
        on: watch,
      });
    } catch (e) {
      toastRef.current?.error(e instanceof Error ? e.message : String(e));
      return;
    }
    setName("");
    setGoal("");
    setWatch([]);
    refresh();
    toastRef.current?.success("Automation added");
  };

  const runNow = async (t: AgentTask) => {
    if (activeRun.current) return;
    if (!fileyAgentEnabled()) {
      toastRef.current?.error("Automations run in the Filey desktop app.");
      return;
    }
    const scope = agentStorageScope();
    if (!scope)
      return toastRef.current?.error(
        "Sign in to this workspace before running an automation."
      );
    setRunning(t.id);
    const controller = new AbortController();
    activeRun.current = { scope, controller };
    if (t.interrupted) updateTask(t.id, { interrupted: false, lastError: undefined }, scope);
    try {
      // Same Filey Agent session as its background runs: a retry sees what the interrupted
      // run already did and checks instead of repeating it. Send and pay steps land under
      // Needs your OK in this drawer, as they do for scheduled runs.
      const summary = await fileyAgentReply(`automation:${t.id}`, t.goal, {
        confirm: parkForApproval({ id: t.id, name: t.name }),
        isOwner: true,
        signal: controller.signal,
        agentId: `automation:${t.id}`,
      });
      if (controller.signal.aborted || agentStorageScope() !== scope) return;
      updateTask(
        t.id,
        { lastRun: Date.now(), lastResult: summary, lastError: undefined },
        scope
      );
      toastRef.current?.success(`"${t.name}" ran`);
    } catch (e) {
      if (controller.signal.aborted || agentStorageScope() !== scope) return;
      updateTask(
        t.id,
        {
          lastRun: Date.now(),
          lastError: e instanceof Error ? e.message : String(e),
        },
        scope
      );
      toastRef.current?.error(`"${t.name}" failed`);
    } finally {
      activeRun.current = null;
      setRunning(null);
      refresh();
    }
  };

  const decide = async (request: ApprovalRequest, approve: boolean) => {
    if (deciding) return;
    setDeciding(request.id);
    try {
      const done = await decideApproval(request.id, approve);
      if (done.status === "done") toastRef.current?.success("Approved and done");
      else if (done.status === "rejected") toastRef.current?.success("Dismissed - it will not run");
      else toastRef.current?.error(done.result || "It did not go through");
    } catch (e) {
      toastRef.current?.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(null);
      refresh();
    }
  };

  const update = async (patch: Partial<typeof settings>) => setSettings(await setAlwaysOn(patch));

  // Portaled out of <main>: see SkillsDrawer — WebView2 half-paints a `fixed`
  // overlay that sits inside a scrolling ancestor.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 flex h-full w-[26rem] max-w-[90vw] flex-col bg-white shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Timer size={18} className="text-primary-500" />
            <p className="font-semibold text-ink">Automations</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-brand-400 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {/* Always on */}
          <div className="rounded-xl border border-brand-200 p-3">
            <div className="flex items-center gap-2">
              <Radio size={14} className={settings.paused ? "text-brand-400" : "text-primary-500"} />
              <p className="flex-1 text-sm font-medium text-ink">
                {settings.paused ? "Agent paused" : "Agent always on"}
              </p>
              <button
                onClick={() => void update({ paused: !settings.paused })}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:hover:bg-white/10"
              >
                {settings.paused ? <Play size={12} /> : <Pause size={12} />}
                {settings.paused ? "Resume" : "Pause"}
              </button>
            </div>
            <p className="mt-1 text-xs text-brand-500">
              {settings.paused
                ? "Automations, watches and the hourly check are on hold. WhatsApp and Telegram chats still get answers."
                : `Runs automations and watches by itself. ${backgroundRunsToday()} of ${DAILY_RUN_LIMIT} background runs used today.`}
            </p>
            {hasTauri && (
              <div className="mt-2 flex items-center gap-2 border-t border-brand-100 pt-2">
                <p className="flex-1 text-xs text-brand-700">
                  Keep working after I close the window (Filey stays in the tray; quit from there)
                </p>
                <Switch
                  on={settings.keepRunning}
                  label={settings.keepRunning ? "On - closing hides Filey to the tray" : "Off - closing quits Filey"}
                  onClick={() => void update({ keepRunning: !settings.keepRunning })}
                />
              </div>
            )}
          </div>

          {/* Needs your OK */}
          {(pending.length > 0 || decided.length > 0) && (
            <div className="mt-4">
              <p className="label">Needs your OK{pending.length ? ` (${pending.length})` : ""}</p>
              <div className="space-y-2">
                {pending.map(r => (
                  <ApprovalCard
                    key={r.id}
                    tool={r.tool}
                    args={approvalArgs(r.tool, r.args)}
                    expiresAt={approvalExpiresAt(r)}
                    from={r.source.name}
                    busy={deciding === r.id}
                    onApprove={() => void decide(r, true)}
                    onDecline={() => void decide(r, false)}
                  />
                ))}
                {decided.map(r => (
                  <p key={r.id} className="text-[11px] text-brand-500">
                    <span className="font-medium text-brand-700">{r.status}</span> · {describeRequest(r.tool, r.args)}
                    {r.result && r.status !== "done" ? ` - ${r.result}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Suggested: one tap to let the agent work ahead */}
          {SUGGESTED.some(s => !tasks.some(t => t.name === s.name)) && (
            <div className="mt-4">
              <p className="label">Let the agent work ahead</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED.filter(s => !tasks.some(t => t.name === s.name)).map(s => (
                  <button
                    key={s.name}
                    type="button"
                    title={s.goal}
                    onClick={() => {
                      try {
                        addTask({ name: s.name, goal: s.goal, schedule: s.schedule, on: s.on });
                        refresh();
                        toastRef.current?.success(`"${s.name}" is on`);
                      } catch (e) {
                        toastRef.current?.error(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:hover:bg-white/10"
                  >
                    <Plus size={12} /> {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create */}
          <div className="mt-4 rounded-xl border border-brand-200 p-3">
            <p className="label">New automation</p>
            <input
              className="input mb-2"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="textarea mb-2 min-h-[64px]"
              placeholder="What should the agent do? e.g. 'Draft a payment reminder for each overdue invoice'"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SelectMenu
                className="w-auto"
                value={type}
                onChange={(v) => setType(v as Schedule["type"])}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "interval", label: "Every…" },
                  { value: "events", label: "When something happens" },
                ]}
              />
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
              ) : type !== "events" ? (
                <>
                  {type === "weekly" && (
                    <SelectMenu
                      className="w-auto"
                      value={String(day)}
                      onChange={(v) => setDay(Number(v))}
                      options={DAYS.map((d, i) => ({ value: String(i), label: d }))}
                    />
                  )}
                  <input
                    type="time"
                    className="input w-32"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] font-medium text-brand-500">
              {type === "events" ? "Run when" : "Also run when"}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
              {WATCH_KINDS.map(kind => (
                <label key={kind} className="flex items-center gap-1.5 text-xs text-brand-700">
                  <input
                    type="checkbox"
                    checked={watch.includes(kind)}
                    onChange={(e) => setWatch(e.target.checked ? [...watch, kind] : watch.filter(k => k !== kind))}
                  />
                  {sentence(WATCH_EVENTS[kind])}
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <button className="btn-primary h-9 px-3 text-sm" onClick={create}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* List */}
          <div className="mt-4 space-y-2">
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-brand-500">
                No automations yet. Add one above, or ask the agent: "every morning, tell me what's overdue".
              </p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="rounded-xl border border-brand-200 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{t.name}</p>
                      <p className="truncate text-xs text-brand-400">{t.goal}</p>
                      <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px] font-medium text-primary-600">
                        <Timer size={11} /> {describeTrigger(t)}
                        {t.lastRun && (
                          <span className="text-brand-400">
                            {" "}
                            · last {new Date(t.lastRun).toLocaleString()}
                          </span>
                        )}
                      </p>
                    </div>
                    <Switch
                      on={t.enabled}
                      label={t.enabled ? "Enabled - click to pause" : "Paused - click to enable"}
                      onClick={() => {
                        updateTask(t.id, { enabled: !t.enabled });
                        refresh();
                      }}
                    />
                  </div>
                  {t.lastError && (
                    <p className={cn("mt-1.5 flex items-center gap-1 text-[11px]", t.interrupted ? "text-amber-600" : "text-danger")}>
                      <AlertTriangle size={11} /> {t.lastError}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => runNow(t)}
                      disabled={running === t.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-white/10"
                    >
                      {running === t.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : t.interrupted ? (
                        <RotateCcw size={12} />
                      ) : (
                        <Play size={12} />
                      )}
                      {t.interrupted ? "Retry" : "Run now"}
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

        <p className="border-t border-brand-200 px-4 py-2.5 text-[11px] text-brand-400">
          {settings.keepRunning && hasTauri
            ? "Automations keep running while Filey is in the tray."
            : "Automations run while Filey is open."}{" "}
          Send and pay steps wait under Needs your OK until you approve them.
        </p>
      </div>
    </div>,
    document.body
  );
}
