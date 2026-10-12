import { autoStartBridge } from "./waBridge";
import { startWaAgent } from "./waAgent";
import { startProactiveAgent } from "./proactiveAgent";
import { startTelegramAgent } from "./telegramAgent";
import { runPendingAgentTask } from "./agentProcessorRunner";

export function startDesktopServices(): void {
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
