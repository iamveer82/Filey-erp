import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Mic, Paperclip } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { aiAgent, aiReady, buildSystemPrompt, getPersona, type AiMessage } from "@shared/ai";
import { startDictation, speechRecognitionSupported } from "@shared/voice";
import { cn } from "@shared/format";
import { Spinner } from "@mobile/components/ui";
/** Filey AI on the phone — the same brain as the desktop and WhatsApp: tools,
 *  memory, confirm gates. One turn at a time; the reply streams in plain text
 *  (tool narration is collapsed into a "working" line). */
export default function Agent() {
  const nav = useNavigate();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(aiReady());
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Voice dictation (browser engine; Android WebView + dev browser have it,
  // iOS WKWebView does not — the mic hides there until a native plugin lands).
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<ReturnType<typeof startDictation> | null>(null);
  const micSupported = useMemo(() => speechRecognitionSupported(), []);

  const toggleMic = () => {
    if (listening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setListening(false);
      return;
    }
    dictationRef.current = startDictation({
      onFinal: (chunk) => setInput((cur) => (cur ? `${cur} ` : "") + chunk),
      onInterim: (draft) => {
        if (textareaRef.current)
          textareaRef.current.placeholder = draft || "Listening…";
      },
      onEnd: () => {
        setListening(false);
        dictationRef.current = null;
        if (textareaRef.current) textareaRef.current.placeholder = "Message Filey AI…";
      },
      onError: () => {
        setListening(false);
        dictationRef.current = null;
        if (textareaRef.current) textareaRef.current.placeholder = "Message Filey AI…";
      },
    });
    setListening(!!dictationRef.current);
  };

  useEffect(() => {
    setReady(aiReady());
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    try {
      const brief = await import("@shared/aiContext")
        .then((m) => m.buildAiContext())
        .catch(() => "");
      const system: AiMessage = {
        role: "system",
        text: buildSystemPrompt(
          "You are Filey, the user's business agent on their phone. Be concise — answers are read on a small screen. Lead with the outcome; keep lists short.",
          getPersona(),
          brief
        ),
      };
      const history: AiMessage[] = turns.slice(-12).map((t) => ({
        role: t.role,
        text: t.text,
      }));
      const reply = await aiAgent([system, ...history, { role: "user", text }], {
        maxTokens: 1600,
        isOwner: true,
      });
      setTurns((t) => [...t, { role: "assistant", text: reply || "…" }]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: `That failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-in mx-auto flex h-dvh w-full max-w-xl flex-col px-4">
      <div className="top-safe flex items-center gap-2 pb-2 pt-3">
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-hover"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-foreground">Filey AI</h1>
          <p className="text-[11px] text-muted-foreground">
            {ready ? "Your business agent" : "Not configured"}
          </p>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-3 overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: "touch" }}>
        {turns.length === 0 && !busy && (
          <div className="mt-10 text-center">
            <p className="text-[14px] font-medium text-foreground">What do you need?</p>
            <p className="mx-auto mt-1 max-w-[32ch] text-[12.5px] text-muted-foreground">
              Draft an invoice, look up a customer, check what's overdue — in plain words.
            </p>
            <div className="mx-auto mt-4 flex max-w-xs flex-wrap justify-center gap-1.5">
              {["What's outstanding?", "This month's revenue", "Low stock check"].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground active:bg-hover"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                t.role === "user"
                  ? "rounded-br-md bg-foreground text-background"
                  : "rounded-bl-md border border-border bg-card text-foreground"
              )}
            >
              {t.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2.5">
              <Spinner className="h-4 w-4" />
              <span className="text-[12.5px] text-muted-foreground">Working…</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="tab-safe border-t border-border bg-page py-2.5">
        {!ready ? (
          <p className="py-2 text-center text-[12.5px] text-warning">
            Add an AI key in the desktop app first — Settings → AI Assistant.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex flex-1 items-end rounded-2xl border border-border bg-card px-3 py-2 focus-within:border-muted-foreground/50">
              <textarea
                ref={textareaRef}
                rows={1}
                className="max-h-28 flex-1 resize-none bg-transparent text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={listening ? "Listening…" : "Message Filey AI…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {micSupported ? (
                <button
                  type="button"
                  aria-label={listening ? "Stop dictation" : "Start dictation"}
                  aria-pressed={listening}
                  onClick={toggleMic}
                  className={cn(
                    "mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                    listening
                      ? "bg-danger/15 text-danger animate-pulse"
                      : "text-muted-foreground active:bg-hover"
                  )}
                >
                  <Mic size={17} />
                </button>
              ) : (
                <Paperclip size={17} className="mb-1 shrink-0 text-muted-foreground/50" />
              )}
            </div>
            <button
              aria-label="Send"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-background transition-transform active:scale-90 disabled:opacity-40"
              style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
            >
              <ArrowUp size={19} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
