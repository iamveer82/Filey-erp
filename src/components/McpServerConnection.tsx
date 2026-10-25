import { useEffect, useState } from "react";
import { Copy, RotateCcw, Plug } from "lucide-react";
import { hasTauri } from "../lib/localPaths";
import { mcpEnabled, mcpStatus, rotateMcpToken, setMcpEnabled, type McpStatus } from "../lib/fileyMcp";

/** Settings → Integrations: let the owner's other agents (their own Hermes, Claude Desktop, any
 *  MCP client) use Filey on this computer. Off until turned on; local connections only. */
export default function McpServerConnection() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (hasTauri) void mcpStatus().then(setStatus).catch(e => setError(String(e)));
  }, []);
  if (!hasTauri) return null;

  const enabled = status?.enabled ?? mcpEnabled();
  const run = (work: Promise<McpStatus>) => {
    setError("");
    void work.then(setStatus).catch(e => setError(e instanceof Error ? e.message : String(e)));
  };
  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    });
  };
  const hermes = status
    ? `mcp_servers:\n  filey:\n    url: ${status.url}\n    headers:\n      Authorization: "Bearer ${status.token}"`
    : "";

  return (
    <section aria-label="Filey for other agents" className="mb-5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Plug size={18} className="mt-0.5 shrink-0 text-primary-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Let your other agents use Filey (MCP)</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your own Hermes, Claude Desktop or any MCP client on this computer can find and run Filey actions.
            Sending and paying still wait for your Approve in Filey. Shell and computer control are not shared.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Let other agents use Filey"
          onClick={() => run(setMcpEnabled(!enabled))}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-primary-400" : "bg-brand-300"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {enabled && status && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">Address</span>
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">{status.url}</code>
            <button type="button" className="btn-ghost h-7 px-2" onClick={() => copy("url", status.url)} aria-label="Copy address">
              <Copy size={12} /> {copied === "url" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">Token</span>
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">{status.token.slice(0, 6)}••••••••</code>
            <button type="button" className="btn-ghost h-7 px-2" onClick={() => copy("token", status.token)} aria-label="Copy token">
              <Copy size={12} /> {copied === "token" ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn-ghost h-7 px-2" onClick={() => run(rotateMcpToken())} title="Agents using the old token stop working">
              <RotateCcw size={12} /> New token
            </button>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">For Hermes, add to its config.yaml:</span>
              <button type="button" className="btn-ghost h-7 px-2" onClick={() => copy("hermes", hermes)}>
                <Copy size={12} /> {copied === "hermes" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-muted px-3 py-2 text-[11px] leading-relaxed">{hermes.replace(status.token, `${status.token.slice(0, 6)}…`)}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
