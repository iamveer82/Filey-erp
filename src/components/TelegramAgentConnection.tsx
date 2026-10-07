import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { onTelegramState, telegramState, telegramSaved, connectTelegram, disconnectTelegram } from "../lib/telegramAgent";
import { agentStorageScope } from "../lib/agentStorage";
import { Copy, Send, ShieldCheck } from "lucide-react";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

export default function TelegramAgentConnection() {
  const [state, setState] = useState(telegramState);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { confirm } = useUI();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => onTelegramState(() => setState(telegramState())), []);
  const desktop = "__TAURI_INTERNALS__" in window;
  const connected = state.state === "connected" || state.state === "pairing";
  const status = !desktop ? "Needs desktop app" : {
    disconnected: "Not connected", connecting: "Connecting…", pairing: "Waiting for pairing", connected: "Connected", error: "Connection problem",
  }[state.state];
  const act = async (work: () => Promise<unknown>) => {
    const scope = agentStorageScope();
    setBusy(true); setFeedback("");
    try { await work(); if (alive.current && scope === agentStorageScope()) setToken(""); }
    catch { if (alive.current && scope === agentStorageScope()) setFeedback(telegramState().error || "Telegram could not complete this action. Check the connection and try again."); }
    finally { if (alive.current && scope === agentStorageScope()) setBusy(false); }
  };
  return (
    <section aria-label="Telegram agent connection" className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted"><Send size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Telegram</h2>
            <span role="status" className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", desktop && state.state === "connected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{status}</span>
          </div>
          <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">Chat with Filey AI and receive documents in your private bot conversation.</p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!desktop ? <p className="text-sm text-muted-foreground">Open the installed Filey desktop app to connect Telegram. Keep it open while requesting work from your phone.</p> : <>
          {!connected && <label className="field max-w-xl"><span className="label">Bot token</span><input className="input mt-1" type="password" autoComplete="new-password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} placeholder={telegramSaved() ? "Saved securely — reconnect or paste a replacement" : "Token from Telegram BotFather"} aria-describedby="telegram-token-help" /><span id="telegram-token-help" className="mt-2 block text-xs leading-relaxed text-muted-foreground">Create a dedicated bot with @BotFather → /newbot. The token is stored in your account’s OS credential vault on this computer.</span></label>}
          {state.username && <a className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4" href={`https://t.me/${state.username}`} target="_blank" rel="noopener noreferrer">Open @{state.username}</a>}
          {state.pairCode && <div className="max-w-xl rounded-lg border border-border bg-muted p-4"><p className="mb-2 text-sm">In your private chat with the bot, send this code within 10 minutes:</p><div className="flex flex-wrap items-center gap-2"><code className="break-all text-sm">PAIR {state.pairCode}</code><button type="button" className="btn-ghost" aria-label="Copy Telegram pairing code" onClick={async () => { try { await navigator.clipboard.writeText(`PAIR ${state.pairCode}`); setFeedback("Pairing code copied."); } catch { setFeedback("Select the code and copy it manually."); } }}><Copy size={15} /></button></div><p className="mt-2 text-xs text-muted-foreground">Keep this code private. It gives that Telegram account access to your enabled Filey tools.</p></div>}
          {state.ownerId && <p className="flex items-center gap-2 text-sm"><ShieldCheck size={16} /> Paired private account · {state.ownerId}</p>}
          <div className="flex flex-wrap gap-2">
            {!connected && <button className="btn-primary" disabled={busy || !token.trim() && !telegramSaved()} onClick={() => void act(() => connectTelegram(token.trim() || undefined))}>{busy ? "Connecting…" : telegramSaved() && !token.trim() ? "Reconnect Telegram" : "Connect Telegram"}</button>}
            {connected && <button className="btn-secondary" disabled={busy} onClick={() => void act(() => disconnectTelegram())}>Disconnect</button>}
            {telegramSaved() && <button className="btn-ghost" disabled={busy} onClick={async () => {
              const expected = agentStorageScope();
              const accepted = await confirm({ title: "Remove Telegram connection?", message: "Stop this agent connection and remove its saved bot token from this Filey account on this computer?", confirmLabel: "Remove connection", danger: true });
              if (accepted && alive.current && expected === agentStorageScope()) void act(() => disconnectTelegram(true));
            }}>Remove connection</button>}
          </div>
        </>}
        {(feedback || state.error) && <p role="status" className="text-sm text-muted-foreground">{feedback || state.error}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">The agent uses your current workspace and AI settings. Sensitive actions ask for one exact approval. Groups and other accounts are ignored. Use /help, /status, /stop or /new in your bot chat.</p>
        <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" to="/docs?article=remote-agent">Connection and permissions guide</Link>
      </div>
    </section>
  );
}
