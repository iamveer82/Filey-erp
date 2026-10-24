import { useEffect, useRef } from "react";
import { loadTasks, isDue, updateTask, type AgentTask } from "../lib/agentTasks";
import { useUI } from "../lib/ui";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { alwaysOnPaused, HEARTBEAT_EVENT, notifyOwner, takeBackgroundRun, DAILY_RUN_LIMIT } from "../lib/alwaysOn";
import { eventsFor, goalWithEvents, scanBusinessEvents, watchedKinds, watchScanDue, type BusinessEvent } from "../lib/agentWatches";
import { parkForApproval } from "../lib/agentApprovals";
import { fileyAgentReply, fileyAgentStatus } from "../lib/fileyAgent";

const INTERRUPTED =
  "Filey closed while this was running. Check what it already did, then press Retry.";

/* The always-on agent's runner. Wakes on the desktop heartbeat (lib/alwaysOn,
 * every 30 s even while the window is hidden in the tray) and once a minute as
 * a fallback. Runs automations that are due and automations whose watched
 * business events happened. Renders nothing.
 *
 * Nobody is watching a background run, so sensitive (money/outbound) tools
 * are never run from here, whatever the agent mode says. They are parked in
 * the review queue (lib/agentApprovals) with their exact arguments, and run
 * only when a person presses Approve. A run cut off by Filey closing is marked
 * interrupted and waits for Retry instead of silently starting over. */
export default function AgentScheduler() {
  const ui = useUI();
  // toast is recreated each render — capture via ref so the effect deps stay []
  // (putting toast in deps would re-run the interval setup endlessly).
  const toastRef = useRef(ui.toast);
  toastRef.current = ui.toast;
  const running = useRef<Set<string>>(new Set());
  // A tick is a loop of awaits; the interval fires regardless. Two sweeps used
  // to interleave — doubling agent runs when several tasks came due together.
  const ticking = useRef(false);
  const checkedInterrupted = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    let runScope: string | null = null;
    let toldLimit = "";
    const stopChangedWorkspace = () => {
      if (runScope !== agentStorageScope()) controller?.abort();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, stopChangedWorkspace);
    window.addEventListener("filey:workspace-changed", stopChangedWorkspace);

    /** A run this mount did not start, still marked running, was cut off. */
    const markInterrupted = (scope: string) => {
      if (checkedInterrupted.current === scope) return;
      checkedInterrupted.current = scope;
      for (const task of loadTasks())
        if (task.runningSince && !running.current.has(task.id))
          updateTask(task.id, { runningSince: undefined, interrupted: true, lastError: INTERRUPTED }, scope);
    };

    const tick = async () => {
      const scope = agentStorageScope();
      if (!alive || ticking.current || !scope) return;
      ticking.current = true;
      try {
        markInterrupted(scope);
        if (alwaysOnPaused()) return;
        let tasks = loadTasks();
        const kinds = watchedKinds(tasks);
        if (kinds.size && watchScanDue()) {
          await scanBusinessEvents(kinds).catch(() => []);
          if (!alive || scope !== agentStorageScope()) return;
          tasks = loadTasks();
        }
        const work = tasks
          .filter(task => !running.current.has(task.id))
          .map(task => ({ task, events: eventsFor(task), due: isDue(task) }))
          .filter(item => item.due || item.events.length);
        if (!work.length) return;
        // Filey Agent runs every automation. While it starts or restarts, wait for the next
        // heartbeat rather than spending the day's allowance on runs that cannot happen.
        if (fileyAgentStatus().state !== "ready") return;
        for (const { task } of work) {
          if (!alive || scope !== agentStorageScope() || alwaysOnPaused()) return;
          const latest = loadTasks().find(t => t.id === task.id);
          if (!latest || running.current.has(task.id)) continue;
          const events = eventsFor(latest);
          if (!isDue(latest) && !events.length) continue;
          if (!takeBackgroundRun()) {
            const day = new Date().toDateString();
            if (toldLimit !== day) {
              toldLimit = day;
              void notifyOwner("Filey automations paused for today", `The daily limit of ${DAILY_RUN_LIMIT} background runs was reached. They resume tomorrow.`);
            }
            return;
          }
          await runTask(latest, events, scope);
        }
      } finally {
        ticking.current = false;
      }
    };

    const runTask = async (t: AgentTask, events: BusinessEvent[], scope: string) => {
      running.current.add(t.id);
      runScope = scope;
      controller = new AbortController();
      const lastEventAt = events.length ? Math.max(...events.map(event => event.at)) : t.lastEventAt;
      updateTask(t.id, { runningSince: Date.now() }, scope);
      try {
        // One Filey Agent session per automation: each run continues its own conversation,
        // so a Retry after an interrupted run sees what that run already did.
        const summary = await fileyAgentReply(`automation:${t.id}`, goalWithEvents(t.goal, events), {
          confirm: parkForApproval({ id: t.id, name: t.name }),
          // The engine's own terminal and file commands: refused with nobody watching.
          confirmCommand: () => false,
          isOwner: false,
          signal: controller.signal,
          agentId: `automation:${t.id}`,
        });
        if (!alive || controller.signal.aborted || scope !== agentStorageScope()) return;
        updateTask(t.id, { lastRun: Date.now(), lastResult: summary, lastError: undefined, runningSince: undefined, lastEventAt }, scope);
        toastRef.current?.success(`Automation "${t.name}" ran`);
        void notifyOwner(`${t.name} finished`, summary || "Done.");
      } catch (e) {
        if (!alive || controller.signal.aborted || scope !== agentStorageScope()) return;
        const message = e instanceof Error ? e.message : String(e);
        // Events are handed over even on failure: the same failure would repeat
        // every heartbeat. Run now from Automations tries again.
        updateTask(t.id, { lastRun: Date.now(), lastError: message, runningSince: undefined, lastEventAt }, scope);
        toastRef.current?.error(`Automation "${t.name}" failed`);
        void notifyOwner(`${t.name} failed`, message);
      } finally {
        running.current.delete(t.id);
      }
    };

    const onHeartbeat = () => void tick();
    window.addEventListener(HEARTBEAT_EVENT, onHeartbeat);
    const first = setTimeout(tick, 8000); // shortly after launch
    const iv = setInterval(tick, 60_000);
    return () => {
      alive = false;
      controller?.abort();
      window.removeEventListener(AGENT_STORAGE_EVENT, stopChangedWorkspace);
      window.removeEventListener("filey:workspace-changed", stopChangedWorkspace);
      window.removeEventListener(HEARTBEAT_EVENT, onHeartbeat);
      clearTimeout(first);
      clearInterval(iv);
    };
  }, []);

  return null;
}
