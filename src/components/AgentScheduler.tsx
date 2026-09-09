import { useEffect, useRef } from "react";
import { loadTasks, isDue, updateTask } from "../lib/agentTasks";
import { aiAutonomous, aiReady, DENY_SENSITIVE } from "../lib/ai";
import { useUI } from "../lib/ui";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";

/* Runs due agent tasks while the app is open. Checks once a minute; each due
 * task runs its goal autonomously. Renders nothing.
 *
 * Sensitive (money/outbound) tools are REFUSED here, whatever the agent mode
 * says. This used to claim they "hit the approval gate", which was untrue in
 * Auto mode — the gate returned "run" and nothing was ever asked, so a timer
 * could send on the owner's behalf. Nobody is watching a scheduled run, so
 * there is no one to approve; tasks read and draft, and the owner sends. */
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

  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    let runScope: string | null = null;
    const stopChangedWorkspace = () => {
      if (runScope !== agentStorageScope()) controller?.abort();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, stopChangedWorkspace);
    window.addEventListener("filey:workspace-changed", stopChangedWorkspace);

    const tick = async () => {
      const scope = agentStorageScope();
      if (!alive || ticking.current || !aiReady() || !scope) return;
      ticking.current = true;
      try {
        for (const t of loadTasks()) {
          if (!alive || scope !== agentStorageScope()) return;
          if (!isDue(t) || running.current.has(t.id)) continue;
          running.current.add(t.id);
          runScope = scope;
          controller = new AbortController();
          try {
            const summary = await aiAutonomous(t.goal, {
              maxRounds: 15,
              confirm: DENY_SENSITIVE,
              signal: controller.signal,
            });
            if (!alive || controller.signal.aborted || scope !== agentStorageScope())
              return;
            updateTask(
              t.id,
              {
                lastRun: Date.now(),
                lastResult: summary,
                lastError: undefined,
              },
              scope
            );
            toastRef.current?.success(`Automation "${t.name}" ran`);
          } catch (e) {
            if (!alive || controller.signal.aborted || scope !== agentStorageScope())
              return;
            updateTask(
              t.id,
              {
                lastRun: Date.now(),
                lastError: e instanceof Error ? e.message : String(e),
              },
              scope
            );
            toastRef.current?.error(`Automation "${t.name}" failed`);
          } finally {
            running.current.delete(t.id);
          }
        }
      } finally {
        ticking.current = false;
      }
    };

    const first = setTimeout(tick, 8000); // shortly after launch
    const iv = setInterval(tick, 60_000);
    return () => {
      alive = false;
      controller?.abort();
      window.removeEventListener(AGENT_STORAGE_EVENT, stopChangedWorkspace);
      window.removeEventListener("filey:workspace-changed", stopChangedWorkspace);
      clearTimeout(first);
      clearInterval(iv);
    };
  }, []);

  return null;
}
