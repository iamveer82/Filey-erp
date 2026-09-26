import { autoStartBridge } from "./waBridge";
import { startWaAgent } from "./waAgent";
import { startProactiveAgent } from "./proactiveAgent";

export function startDesktopServices(): void {
  startWaAgent();
  startProactiveAgent();
  void autoStartBridge().catch(() => console.warn("WhatsApp could not start; open Integrations to retry."));
}
