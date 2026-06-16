/* React CopilotKit wrapper — replaces the legacy floating chat with
 * CopilotKit's agent UI while keeping all existing aiTools wired in.
 * Runtime endpoint: http://localhost:4000/copilotkit (started from
 * server/copilot-runtime.mjs). */
import {
  CopilotKit,
  useCopilotAction,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAiConfig, aiReady, type AiConfig } from "../lib/ai";
import { TOOLS, setToolConfirm } from "../lib/aiTools";
import { useUI } from "../lib/ui";
import "@copilotkit/react-ui/styles.css";

export default function CopilotKitProvider() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  useEffect(() => {
    const c = getAiConfig();
    setCfg(aiReady(c) ? c : null);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("filey-toggle-copilot"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!cfg) {
    // AI not configured: keep the old manual button? No, show nothing.
    return null;
  }

  const configB64 = btoa(
    JSON.stringify({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
    })
  );

  return (
    <CopilotKit
      runtimeUrl="http://localhost:4000/copilotkit"
      headers={{ "X-Filey-AI-Config": configB64 }}
    >
      <CopilotInner />
    </CopilotKit>
  );
}

function CopilotInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, confirm } = useUI();
  useEffect(() => {
    setToolConfirm(async (name, args) => {
      return await confirm({
        title: `Allow AI action: ${name}`,
        message: JSON.stringify(args, null, 2).slice(0, 400),
        confirmLabel: "Run",
      });
    });
  }, [confirm]);

  // Current page context.
  useCopilotReadable({
    description: "The page the user is currently viewing in Filey ERP.",
    value: location.pathname + location.hash,
  });

  // Navigation action.
  useCopilotAction({
    name: "navigate",
    description: "Navigate to a Filey page by route",
    parameters: [
      { name: "route", type: "string", description: "e.g. /invoicing, /inventory" },
    ],
    handler: async ({ route }: { route: string }) => {
      navigate(route.startsWith("#") ? route.slice(1) : route);
      return `Navigated to ${route}`;
    },
  });

  // Register every existing aiTool as a CopilotKit action.
  // Wrap in a custom hook so React doesn't complain about loops.
  useFileyTools(toast, confirm);

  return (
    <CopilotPopup
      instructions="You are Filey AI, an ERP assistant. Use the provided tools to read data and perform actions on behalf of the user. Confirm before creating invoices, sending emails, or spending money. Be concise."
      labels={{ title: "Filey AI", initial: "Ask me to create an invoice, check stock, or run a report.", placeholder: "Type a command…" }}
    />
  );
}

function useFileyTools(
  toast: ReturnType<typeof useUI>["toast"],
  confirm: ReturnType<typeof useUI>["confirm"]
) {
  for (const tool of TOOLS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useCopilotAction({
      name: tool.name,
      description: tool.description,
      parameters: Object.entries(tool.parameters.properties || {}).map(([name, spec]) => ({
        name,
        type: (spec as any).type || "string",
        description: (spec as any).description || "",
        required: ((tool.parameters.required as string[]) || []).includes(name),
      })),
      handler: async (args: Record<string, unknown>) => {
        if (tool.sensitive) {
          const ok = await confirm({
            title: `Allow: ${tool.name}`,
            message: JSON.stringify(args, null, 2).slice(0, 400),
            confirmLabel: "Run",
          });
          if (!ok) return "User denied this action.";
        }
        try {
          return await tool.run(args);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`AI action failed: ${msg}`);
          return `Error: ${msg}`;
        }
      },
    });
  }
}
