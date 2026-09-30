import { autoStartBridge } from "./waBridge";
import { startWaAgent } from "./waAgent";
import { startProactiveAgent } from "./proactiveAgent";
import { startTelegramAgent } from "./telegramAgent";

export function startDesktopServices(): void {
  startWaAgent();
  startTelegramAgent();
  startProactiveAgent();
  void autoStartBridge().catch(() => console.warn("WhatsApp could not start; open Integrations to retry."));
}
