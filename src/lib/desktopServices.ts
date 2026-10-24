import { autoStartBridge } from "./waBridge";
import { startWaAgent } from "./waAgent";
import { startProactiveAgent } from "./proactiveAgent";
import { startTelegramAgent } from "./telegramAgent";
import { runPendingAgentTask } from "./agentProcessorRunner";
import { fileyAgentEnabled, startFileyAgent } from "./fileyAgent";
import { startAlwaysOn } from "./alwaysOn";

export function startDesktopServices(): void {
  // Tray, heartbeat and pause: the agent keeps working after the window closes.
  void startAlwaysOn().catch(error => console.warn("Always-on agent could not start.", error));
  // Filey as an MCP server for the owner's other agents; stays off until turned on.
  void import("./fileyMcp").then(m => m.startMcpBridge()).catch(error => console.warn("Filey MCP bridge could not start.", error));
  // Filey Agent (Hermes) is the app's agent: it starts with the app and is restarted if it
  // stops. It only ever starts from here (a one-time launch secret, see filey_agent.rs).
  if (fileyAgentEnabled()) void startFileyAgent();
  startWaAgent();
  startTelegramAgent();
  startProactiveAgent();
  void autoStartBridge().catch(() => console.warn("WhatsApp could not start; open Integrations to retry."));
  void (async () => {
    while (true) {
      const did = await runPendingAgentTask("desktop-worker", ["assistant_turn"]).catch(() => false);
      if (!did) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  })();
}
