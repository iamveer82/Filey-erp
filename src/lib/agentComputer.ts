import { agentStorageScope } from "./agentStorage";
import { isToolAllowed } from "./capabilities";
import { desktopBrowserCommand, getBrowserPanelState, closeDesktopBrowserTabs } from "./desktopBrowser";
import { enableComputerUse, disableComputerUse, computerUseSessionActive, runComputerUse } from "./computerUse";

let binding: { scope: string; agent: string; tab: string; session: number } | null = null;
const observedSignals = new WeakSet<AbortSignal>();

export async function stopAgentComputer(agent: string, closeTabs = true) {
  const previous = binding?.agent === agent ? binding : null;
  if (previous) binding = null;
  await Promise.all([
    previous ? disableComputerUse(previous.session) : Promise.resolve(),
    closeTabs && getBrowserPanelState().agentId === agent ? closeDesktopBrowserTabs() : Promise.resolve(),
  ]);
}

/** Browser-only computer actions. No Docker, network service or host shell.
 * Native screenshots/input are clipped and bound to one visible browser tab. */
export async function agentComputerCommand(args: Record<string, unknown>, agent: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const scope = agentStorageScope();
  if (!scope || !agent) throw new Error("Start this task in a signed-in conversation.");
  signal?.throwIfAborted();
  if (signal && !observedSignals.has(signal)) {
    observedSignals.add(signal);
    signal.addEventListener("abort", () => {
      if (scope === agentStorageScope()) void stopAgentComputer(agent, signal.reason?.message !== "Task completed").catch(() => {});
    }, { once: true });
  }
  if (args.action === "stop") { await stopAgentComputer(agent); return { stopped: true, profile_preserved: true }; }
  if (!isToolAllowed("agent_computer")) throw new Error("Agent computers are off. Enable Agent computers (optional) in Filey AI → Agent access → Manage action groups to use this feature.");
  if (getBrowserPanelState().paused) throw new Error("The user has control. Wait for them to resume the agent; do not bypass takeover.");
  if (["open", "navigate", "list"].includes(String(args.action))) {
    const result = await desktopBrowserCommand(args, signal, agent);
    return { ...result, environment: "Filey built-in browser", isolated_operating_system: false };
  }
  const panel = getBrowserPanelState();
  if (panel.agentId !== agent) throw new Error("Open this conversation's browser workspace first.");
  const tabId = typeof args.tab_id === "string" ? args.tab_id : panel.activeId;
  const tab = panel.tabs.find(t => t.id === tabId);
  if (!tab?.window_id) throw new Error("Choose an open browser tab, then take a screenshot.");
  if (args.action === "screenshot") {
    await desktopBrowserCommand({ action: "focus", tab_id: tab.id }, signal, agent);
    signal?.throwIfAborted();
    if (scope !== agentStorageScope() || getBrowserPanelState().paused) throw new DOMException("Browser task stopped", "AbortError");
    const session = await enableComputerUse(null, tab.window_id, tab.id);
    if (!isToolAllowed("agent_computer") || signal?.aborted || scope !== agentStorageScope()) {
      await disableComputerUse(session);
      throw new DOMException("Agent computer stopped", "AbortError");
    }
    binding = { scope, agent, tab: tab.id, session };
    await runComputerUse({ action: "list_windows" }, signal, session);
    const result = await runComputerUse({ action: "screenshot", window_id: tab.window_id }, signal, session);
    return { ...result, tab_id: tab.id };
  }
  const active = binding;
  if (!active || active.agent !== agent || active.scope !== scope || active.tab !== tab.id || !computerUseSessionActive(active.session))
    throw new Error("Take a fresh screenshot of this tab before acting. A stopped session cannot be reused.");
  return runComputerUse(args, signal, active.session);
}
