import { useEffect, useRef } from "react";
import { loadTasks, isDue, updateTask } from "../lib/agentTasks";
import { aiAutonomous, aiReady } from "../lib/ai";
import { useUI } from "../lib/ui";

/* Runs due agent tasks while the app is open. Checks once a minute; each due
 * task runs its goal autonomously. Renders nothing. Sensitive tools inside a
 * task still hit the approval gate, so unattended tasks are best for
 * read/report work. */
export default function AgentScheduler() {
  const ui = useUI();
  // toast is recreated each render — capture via ref so the effect deps stay []
  // (putting toast in deps would re-run the interval setup endlessly).
  const toastRef = useRef(ui.toast);
  toastRef.current = ui.toast;
  const running = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive || !aiReady()) return;
      for (const t of loadTasks()) {
        if (!isDue(t) || running.current.has(t.id)) continue;
        running.current.add(t.id);
        try {
          const summary = await aiAutonomous(t.goal, { maxRounds: 15 });
          updateTask(t.id, {
            lastRun: Date.now(),
            lastResult: summary,
            lastError: undefined,
          });
          toastRef.current?.success(`Automation "${t.name}" ran`);
        } catch (e) {
          updateTask(t.id, {
            lastRun: Date.now(),
            lastError: e instanceof Error ? e.message : String(e),
          });
          toastRef.current?.error(`Automation "${t.name}" failed`);
        } finally {
          running.current.delete(t.id);
        }
      }
    };

    const first = setTimeout(tick, 8000); // shortly after launch
    const iv = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, []);

  return null;
}
