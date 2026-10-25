import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import ApprovalCard from "./ApprovalCard";
import {
  FILEY_AGENT_STATUS_EVENT,
  fileyAgentComplete,
  fileyAgentSlash,
  fileyAgentStatus,
  fileyAgentTurn,
  forgetFileyAgentSession,
  retryFileyAgent,
  type FileyAgentCompletion,
  type FileyAgentStatus,
} from "../lib/fileyAgent";
import { approvalArgs, endTurn } from "../lib/aiTools";
import { fullAccessPreapproved } from "../lib/agentMode";
import { readAgentStorage, writeAgentStorage } from "../lib/agentStorage";
import { cn } from "../lib/format";

/* Filey Agent's terminal: Hermes' own way of working (slash commands, streamed output,
 * tool lines) inside Filey, on its own engine session. It never opens a console window;
 * the engine still starts only from the app, and every business action goes through the
 * same tools and approvals as the chat. */

type LineKind = "user" | "assistant" | "tool" | "notice" | "error";
interface Line { id: number; kind: LineKind; text: string }
interface Pending { id: number; name: string; args: Record<string, unknown>; resolve: (ok: boolean) => void }

const CHAT_ID = "terminal:main";
const STORE_KEY = "filey.agent.terminal";
const KEEP = 400;
const HELP = [
  "Type a task, or a command:",
  "  /help      everything Filey Agent can do here",
  "  /model     see or switch the model",
  "  /skills    installed skills",
  "  /new       start a fresh session",
  "  /clear     clear this screen",
  "Keys: Enter send · Tab complete · ↑/↓ history · Ctrl+C stop · Ctrl+L clear",
].join("\n");

function loadLines(): Line[] {
  try {
    const rows: unknown = JSON.parse(readAgentStorage(STORE_KEY) ?? "[]");
    return Array.isArray(rows)
      ? rows.filter((row): row is Line => !!row && typeof row.id === "number" && typeof row.text === "string").slice(-KEEP)
      : [];
  } catch {
    return [];
  }
}

const brief = (args: Record<string, unknown>) => {
  const text = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

function outcome(result: unknown): { failed: boolean; text: string } {
  if (result && typeof result === "object" && "error" in result)
    return { failed: true, text: String((result as { error: unknown }).error) };
  if (result && typeof result === "object" && "waiting_for_approval" in result)
    return { failed: false, text: "waiting for your OK" };
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "done");
  return { failed: false, text: text.length > 140 ? `${text.slice(0, 137)}...` : text };
}

export default function AgentTerminal({ active }: { active: boolean }) {
  const [lines, setLines] = useState<Line[]>(loadLines);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<FileyAgentStatus>(fileyAgentStatus);
  const [suggestions, setSuggestions] = useState<FileyAgentCompletion[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(lines.reduce((max, line) => Math.max(max, line.id), 0));
  const history = useRef<string[]>([]);
  const historyAt = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  /** Lines typed while a task runs: they steer it (Hermes /steer). */
  const steerRef = useRef<string[]>([]);
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = (e: Event) => setEngine((e as CustomEvent<FileyAgentStatus>).detail ?? fileyAgentStatus());
    window.addEventListener(FILEY_AGENT_STATUS_EVENT, update);
    return () => window.removeEventListener(FILEY_AGENT_STATUS_EVENT, update);
  }, []);
  // Keep the screen across visits (the last 400 lines, this account only).
  useEffect(() => {
    const timer = setTimeout(() => {
      try { writeAgentStorage(STORE_KEY, JSON.stringify(lines.slice(-KEEP))); } catch { /* signed out */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [lines]);
  useEffect(() => {
    const out = outRef.current;
    if (out) out.scrollTop = out.scrollHeight;
  }, [lines, pending]);
  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);
  useEffect(() => () => {
    abortRef.current?.abort();
    pendingRef.current?.resolve(false); // deny rather than hang
  }, []);

  const append = useCallback((kind: LineKind, text: string): number => {
    const id = ++seq.current;
    setLines(prev => [...prev, { id, kind, text }].slice(-KEEP));
    return id;
  }, []);
  const replace = useCallback((id: number, text: string) => {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, text } : line)));
  }, []);

  /** Sensitive actions ask right here, with the same card as the chat. */
  const askApproval = useCallback((name: string, args: Record<string, unknown>) => {
    if (fullAccessPreapproved(undefined, name)) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      pendingRef.current?.resolve(false);
      const request = { id: ++seq.current, name, args, resolve };
      pendingRef.current = request;
      setPending(request);
    });
  }, []);
  const settle = (request: Pending, ok: boolean) => {
    if (pendingRef.current !== request) return;
    pendingRef.current = null;
    setPending(null);
    request.resolve(ok);
  };

  const run = async (text: string, shown?: string) => {
    if (shown) append("notice", shown);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = `terminal-${crypto.randomUUID()}`;
    let live: number | null = null;
    let liveText = "";
    let said = false;
    try {
      const stream = fileyAgentTurn(CHAT_ID, text, {
        confirm: askApproval, isOwner: true, signal: controller.signal, agentId: CHAT_ID, turnId,
        drainSteer: () => steerRef.current.splice(0),
        returnSteer: texts => { steerRef.current.unshift(...texts); },
      });
      for (;;) {
        const step = await stream.next();
        if (step.done) {
          if (live !== null && step.value) replace(live, step.value);
          else if (!said && step.value) append("assistant", step.value);
          break;
        }
        const ev = step.value;
        if (ev.type === "delta") {
          if (live === null) { live = append("assistant", ""); liveText = ""; }
          liveText += ev.text;
          replace(live, liveText);
          said = true;
        } else if (ev.type === "text") {
          if (live !== null) replace(live, ev.text);
          else append("assistant", ev.text);
          live = null;
          said = true;
        } else if (ev.type === "tool_call") {
          live = null;
          said = false;
          append("tool", `● ${ev.name}${Object.keys(ev.args).length ? ` ${brief(approvalArgs(ev.name, ev.args))}` : ""}`);
        } else if (ev.type === "tool_result") {
          const result = outcome(ev.result);
          append(result.failed ? "error" : "tool", `  ⎿ ${result.failed ? "✗" : "✓"} ${result.text}`);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) append("notice", "Stopped. An action already running may have finished; check before repeating it.");
      else append("error", error instanceof Error ? error.message : String(error));
    } finally {
      const files = endTurn(turnId);
      if (files.length) append("notice", `Saved: ${files.map(file => file.path || file.name).join(", ")}`);
      // Steering that arrived as the task ended goes back to the prompt, not the bin.
      const leftover = steerRef.current.splice(0);
      if (leftover.length) setInput(leftover.join(" "));
      abortRef.current = null;
      setBusy(false);
    }
  };

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    history.current = [...history.current.filter(item => item !== text), text].slice(-100);
    historyAt.current = -1;
    setInput("");
    setSuggestions([]);
    if (text === "/clear") { setLines([]); return; }
    if (busy && !text.startsWith("/")) {
      // Mid-task: this steers the running task, as in Hermes.
      steerRef.current.push(text);
      append("user", `${text}  ↳ steering`);
      return;
    }
    append("user", text);
    if (text === "/new") {
      forgetFileyAgentSession(CHAT_ID);
      append("notice", "Started a fresh session.");
      return;
    }
    if (text === "/" || text === "/?") { append("notice", HELP); return; }
    if (!text.startsWith("/")) { await run(text); return; }
    const running = busy; // commands like /steer, /queue and /btw act on the running task
    if (!running) setBusy(true);
    try {
      const result = await fileyAgentSlash(CHAT_ID, text);
      if (!running) setBusy(false);
      if (result.kind === "send" && running) append("notice", result.notice ?? "Sent to the running task.");
      else if (result.kind === "output") append("notice", result.text);
      else if (result.kind === "prefill") {
        if (result.notice) append("notice", result.notice);
        setInput(result.message);
      } else {
        if (result.notice) append("notice", result.notice);
        await run(result.message, result.display);
      }
    } catch (error) {
      append("error", error instanceof Error ? error.message : String(error));
    } finally {
      if (!running) setBusy(false);
    }
  };

  // Suggestions for a command being typed (no space yet).
  useEffect(() => {
    if (!input.startsWith("/") || /\s/.test(input)) { setSuggestions([]); return; }
    let stale = false;
    const timer = setTimeout(() => {
      void fileyAgentComplete(CHAT_ID, input).then(items => { if (!stale) setSuggestions(items); }).catch(() => {});
    }, 120);
    return () => { stale = true; clearTimeout(timer); };
  }, [input]);

  const complete = (item: FileyAgentCompletion) => {
    const text = item.text.startsWith("/") ? item.text : `/${item.text}`;
    setInput(`${text} `);
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); void submit(input); return; }
    if (e.key === "Tab" && suggestions.length) { e.preventDefault(); complete(suggestions[0]); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && busy && !window.getSelection()?.toString()) {
      e.preventDefault();
      abortRef.current?.abort();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); setLines([]); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const items = history.current;
      if (!items.length) return;
      e.preventDefault();
      const at = historyAt.current === -1 ? items.length : historyAt.current;
      const next = e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 1;
      historyAt.current = next >= items.length ? -1 : next;
      setInput(next >= items.length ? "" : items[next]);
    }
  };

  const state = engine.state === "ready" ? (busy ? "working" : "ready")
    : engine.state === "unavailable" || engine.state === "restarting" || engine.state === "installing"
      ? `${engine.state}${engine.state === "installing" && engine.percent !== undefined ? ` ${engine.percent}%` : ""}`
      : "starting";

  return (
    <section className="filey-terminal" aria-label="Filey Agent terminal" onClick={() => inputRef.current?.focus()}>
      <header className="filey-terminal-bar">
        <span className="filey-terminal-dot" data-state={state} />
        <span>filey-agent</span>
        <span className="text-white/40">· {state}</span>
        {engine.state === "unavailable" && (
          <button type="button" className="ml-auto underline-offset-2 hover:underline" onClick={() => void retryFileyAgent()}>
            Retry
          </button>
        )}
      </header>
      <div ref={outRef} className="filey-terminal-out" role="log" aria-live="polite">
        {!lines.length && <p className="filey-terminal-line" data-kind="notice">{HELP}</p>}
        {lines.map(line => (
          <p key={line.id} className="filey-terminal-line" data-kind={line.kind}>
            {line.kind === "user" ? <><span className="filey-terminal-prompt">›</span> {line.text}</> : line.text}
          </p>
        ))}
        {engine.state === "unavailable" && engine.message && (
          <p className="filey-terminal-line" data-kind="error">{engine.message}</p>
        )}
        {pending && (
          <div className="mt-2 max-w-md text-foreground" onClick={e => e.stopPropagation()}>
            <ApprovalCard
              key={pending.id}
              tool={pending.name}
              args={approvalArgs(pending.name, pending.args)}
              onApprove={() => settle(pending, true)}
              onDecline={() => settle(pending, false)}
            />
          </div>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul className="filey-terminal-suggest" role="listbox" aria-label="Commands">
          {suggestions.map((item, i) => (
            <li key={`${item.text}-${i}`}>
              <button type="button" role="option" aria-selected={i === 0} onClick={() => complete(item)}>
                <span>{item.display}</span>
                {item.meta && <span className="text-white/40">{item.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="filey-terminal-input">
        <span className={cn("filey-terminal-prompt", busy && "opacity-40")}>›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); historyAt.current = -1; }}
          onKeyDown={onKeyDown}
          aria-label="Command for Filey Agent"
          placeholder={busy ? "Working… Ctrl+C to stop" : "Type a task or /help"}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </section>
  );
}
