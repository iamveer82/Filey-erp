import { useEffect, useRef, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";

import { FileySpinner as Loader2 } from "./FileySpinner";
import BrandIcon from "./BrandIcon";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";
import { AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { waLogList } from "../lib/waLog";
import {
  hasDesktop,
  getBridgeConfig,
  setBridgeConfig,
  bridgeState,
  startBridge,
  stopBridge,
  resetBridge,
  onBridgeState,
  type BridgeConfig,
  type BridgeState,
} from "../lib/waBridge";

/* ── WhatsApp bridge: QR-paired session, no per-message cost ─────────────── */
export default function WhatsAppConnection() {
  const { confirm } = useUI();
  const desktop = hasDesktop;
  const [cfg, setCfg] = useState<BridgeConfig>(() =>
    desktop ? getBridgeConfig() : { autoStart: false, ownerNumber: "" }
  );
  const [st, setSt] = useState<BridgeState>({ state: "stopped" });
  const [msg, setMsg] = useState("");
  const [ownerNumber, setOwnerNumber] = useState(cfg.ownerNumber);
  // What the bridge actually saw, newest first — "is it receiving my
  // messages, is it answering" answered by evidence instead of guesswork.
  const [activity, setActivity] = useState(() => waLogList({ limit: 4 }).reverse());
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    let receivedEvent = false;
    const unlisten = onBridgeState((state) => {
      receivedEvent = true;
      if (current) setSt(state);
    });
    void bridgeState().then((state) => {
      if (current && !receivedEvent) setSt(state);
    });
    return () => { current = false; unlisten(); };
  }, [desktop]);

  // Replies don't change connection status: refresh when the conversation is
  // saved as well, so a live connection never shows a stale activity trail.
  useEffect(() => {
    const refresh = () => setActivity(waLogList({ limit: 4 }).reverse());
    refresh();
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
  }, [st.state]);

  // The browser build has no WhatsApp bridge to drive — the card still shows
  // the full pairing surface, locked, so it's obvious what WhatsApp connect
  // is and that it lives in the desktop app.
  const locked = !desktop;

  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setSt(await bridgeState());
      const next = getBridgeConfig();
      setCfg(next);
      setOwnerNumber(next.ownerNumber);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const connected = st.state === "connected";
  const pairedPhone = st.me?.split("@")[0].split(":")[0] ?? "";
  const separateOwner = !!cfg.ownerNumber && cfg.ownerNumber !== pairedPhone;
  const pairing = st.state === "starting" || st.state === "connecting";
  const label: Record<string, string> = locked
    ? { stopped: "Needs desktop app" }
    : {
        stopped: "Not running",
        starting: "Starting…",
        connecting: st.qr ? "Waiting for QR scan" : "Connecting…",
        connected: "Connected",
        reconnecting: "Reconnecting…",
        logged_out: "Pair again",
        error: "Connection problem",
      };

  return (
    <section aria-label="WhatsApp connection" className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-5">
        <div className="h-10 w-10 rounded-[8px] bg-muted text-foreground grid place-items-center shrink-0">
          <BrandIcon name="whatsapp" className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">WhatsApp</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                connected
                  ? "bg-success/15 text-success"
                  : pairing
                    ? "bg-info/10 text-info"
                    : "bg-muted text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected
                    ? "bg-success"
                    : pairing
                      ? "bg-info"
                      : "bg-muted-foreground/50"
                )}
              />
              {label[st.state] ?? st.state}
            </span>
          </div>
          <p className="mt-1 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
            Ask Filey AI for help, documents and PDFs from your WhatsApp chat.
          </p>
        </div>
      </div>

      <div className="grid gap-5 border-t border-border p-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
        <div className="min-w-0">
          {locked ? (
            <>
              <h3 className="text-sm font-medium">Connect from the desktop app</h3>
              <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
                This browser cannot pair a WhatsApp account. Open the installed Filey app, then go to Integrations → Built-in connections → Connect WhatsApp.
              </p>
            </>
          ) : connected ? (
            <>
              <h3 className="text-sm font-medium">Send a task from your phone</h3>
              <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
                {separateOwner ? "From your owner number, send a message to the paired number." : "On your phone, open your own WhatsApp chat (Message yourself) and send a task."}
                {" "}Keep Filey open and signed in.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Send <code className="font-mono text-foreground">/status</code> to check that the agent is ready. A paired connection alone does not confirm an AI reply.</p>
            </>
          ) : (
            <>
              <h3 className="text-sm font-medium">Link your phone</h3>
              <ol className="mt-2 list-decimal space-y-2 ps-4 text-[13px] leading-relaxed text-muted-foreground">
                <li>Select Connect WhatsApp to show a QR code.</li>
                <li>On your phone, open WhatsApp → Settings → <b className="font-medium text-foreground">Linked devices</b> → Link a device.</li>
                <li>Scan the code, then send <code className="font-mono text-foreground">/status</code> in your own chat.</li>
              </ol>
            </>
          )}
          {st.qr && !connected && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <img src={st.qr} alt="WhatsApp pairing QR code" width={192} height={192} className="h-48 w-48 shrink-0 rounded-[8px] bg-white p-2" />
              <p className="max-w-48 text-xs leading-relaxed text-muted-foreground">Keep this code private. It links your WhatsApp account to Filey on this computer.</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={locked || busy || pairing || connected || st.state === "reconnecting"}
          title={locked ? "Needs the desktop app" : undefined}
          onClick={() => run(startBridge)}
        >
          {busy || pairing ? <Loader2 size={14} className="animate-spin" /> : null}
          {connected ? "WhatsApp connected" : pairing || busy ? "Connecting…" : st.state === "reconnecting" ? "Reconnecting…" : "Connect WhatsApp"}
        </button>
        {st.state !== "stopped" && (
          <button className="btn-ghost" disabled={locked || busy} onClick={() => run(stopBridge)}>
            Stop
          </button>
        )}
        <button
          className="btn-ghost"
          disabled={locked || busy}
          title={
            locked
              ? "Needs the desktop app"
              : "Forget the pairing and show a fresh QR. Use this if your phone shows “Waiting for this message”."
          }
          onClick={async () => {
            if (await confirm({
              title: "Reconnect WhatsApp?",
              message: "Unpair this WhatsApp session and start over? You'll scan a new QR code.",
              confirmLabel: "Re-pair",
            }))
              void run(resetBridge);
          }}
        >
          Re-pair
        </button>
          </div>
          {(msg || st.error) && (
            <p role="status" className="mt-3 text-[13px] leading-relaxed text-danger">{whatsAppError(msg || st.error || "")}</p>
          )}
        </div>
        <aside className="min-w-0 text-[13px] leading-relaxed">
          <div className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Your private connection</div>
          <p className="mt-2 text-muted-foreground">The agent answers your own chat or the owner number you choose. Messages to other people require your approval.</p>
          {connected && st.me && (
            <dl className="mt-3 space-y-2">
              <div><dt className="text-xs text-muted-foreground">Paired phone</dt><dd className="font-medium tabular-nums">+{pairedPhone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Who can send tasks</dt><dd>{separateOwner ? `+${cfg.ownerNumber}` : "Your own chat only"}</dd></div>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">No API key or per-message bridge fee. Your AI provider may charge for model usage.</p>
        </aside>
      </div>
      <div className="grid gap-4 border-t border-border p-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <div><h3 className="text-[13px] font-medium">Connection preferences</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose who can reach your agent.</p></div>
        <div className="min-w-0 space-y-4">
          <label className="flex min-h-10 items-center gap-2 text-[13px]">
            <input type="checkbox" disabled={locked || busy} checked={cfg.autoStart} onChange={(e) => {
              try { setCfg(setBridgeConfig({ autoStart: e.target.checked })); setMsg(""); }
              catch (error) { setMsg(error instanceof Error ? error.message : String(error)); }
            }} />
            Start with Filey
          </label>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (locked || busy || ownerNumber.trim() === cfg.ownerNumber) return;
            void run(async () => {
              setCfg(setBridgeConfig({ ownerNumber: ownerNumber.trim() }));
              if (connected || pairing || st.state === "reconnecting") await startBridge();
            });
          }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1"><span className="label">My WhatsApp number</span><input className="input mt-1" placeholder="Country code + phone number" inputMode="tel" type="tel" disabled={locked || busy} value={ownerNumber} onChange={e => setOwnerNumber(e.target.value)} aria-describedby="whatsapp-owner-help" /></label>
              <button className="btn-ghost" disabled={locked || busy || ownerNumber.trim() === cfg.ownerNumber}>Save number</button>
            </div>
            <p id="whatsapp-owner-help" className="mt-2 text-xs leading-relaxed text-muted-foreground">Leave empty when you paired your own phone. Only set a number when you want to send tasks from a different phone.</p>
          </form>
        </div>
      </div>
      {!locked && activity.length > 0 && (
        <details className="group border-t border-border px-5">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium">Recent activity <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <ul className="space-y-3 pb-5">
            {activity.map((e, i) => <li key={i} className="flex items-start gap-3 text-xs">
              <span className="shrink-0 font-medium">{e.dir === "in" ? "Received" : "Sent"}</span>
              <span className="min-w-0 flex-1 break-words text-muted-foreground">{e.text}</span>
              <time className="shrink-0 text-muted-foreground" dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
            </li>)}
          </ul>
        </details>
      )}
      <details className="group border-t border-border px-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium">Using WhatsApp with Filey <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary>
        <div className="max-w-[75ch] space-y-2 pb-5 text-xs leading-relaxed text-muted-foreground">
          <p>Ask for an invoice PDF, or attach a PDF or image up to 12 MB for Filey to work on. Send /stop to cancel a task.</p>
          <p>Your pairing is saved on this computer. Filey must remain open and signed in to receive tasks.</p>
          <p>This is an unofficial linked-device connection; WhatsApp may restrict unsupported clients.</p>
        </div>
      </details>
    </section>
  );
}

function whatsAppError(error: string) {
  if (/another Filey account/i.test(error)) return "This phone is linked to another Filey account. Select Re-pair to connect your own phone.";
  if (/sign in/i.test(error)) return "Sign in to Filey before connecting WhatsApp or changing its preferences.";
  if (/workspace changed|account changed/i.test(error)) return "Your workspace changed. Connect WhatsApp again in this workspace.";
  if (/Connect WhatsApp once/i.test(error)) return "Select Connect WhatsApp to link the saved pairing to this Filey account.";
  if (/already running in another Filey window/i.test(error)) return "WhatsApp is running in another Filey window. Close that window, then connect here.";
  if (/binary|not installed|sidecar.*missing/i.test(error)) return "This desktop build is missing WhatsApp support. Install the latest Filey update, then try again.";
  if (/could not read WhatsApp connection status/i.test(error)) return "Filey could not check the WhatsApp connection. Close and reopen Filey, then check again.";
  if (/could not save its pairing|no space|disk full|ENOSPC|os error 112/i.test(error)) return "WhatsApp could not save its pairing on this computer. Check free disk space and folder permissions, then connect again.";
  if (/could not clear WhatsApp pairing/i.test(error)) return "Filey could not remove the old WhatsApp pairing. Close other Filey windows, check folder permissions, then select Re-pair again.";
  if (/could not protect the WhatsApp session|access (?:is )?denied|permission denied|EACCES|EPERM|os error 5\b/i.test(error)) return "Filey cannot access its WhatsApp session files. Close other Filey windows and check your app folder permissions, then try again.";
  if (/rejected this session|connection.?replaced|session.*replaced|multidevice.?mismatch/i.test(error)) return "WhatsApp rejected or replaced this session. Close other Filey windows and connect again. If it persists, select Re-pair.";
  if (/could not start bridge|WhatsApp bridge could not start/i.test(error)) return "WhatsApp could not start on this computer. Close and reopen Filey, then connect again. If it persists, install the latest Filey update.";
  if (/could not reconnect|disconnected|connection dropped/i.test(error)) return "The WhatsApp connection was lost. Check your internet connection, then select Connect WhatsApp to try again.";
  if (/owner|phone number|country code/i.test(error)) return "Enter a valid phone number with its country code, or leave it empty to use your own chat.";
  if (/logged.?out|unauthorized|bad session|restart.?required/i.test(error)) return "Your WhatsApp session needs to be linked again. Select Re-pair and scan the new code.";
  return "WhatsApp could not complete this action. Close and reopen Filey, then try again. If it continues, contact support.";
}
