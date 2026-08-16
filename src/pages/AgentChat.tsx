import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Loader2,
  Zap,
  Paperclip,
  X,
  Download,
  FolderOpen,
  Brain,
  Trash2,
  ShieldAlert,
  ArrowUp,
  FileText,
  History,
  CalendarClock,
  BookOpen,
  SlidersHorizontal,
  User,
  Copy,
  Check,
  Square,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import Markdown from "../components/Markdown";
import { openFolder } from "../lib/localPaths";
import { ErrorBanner, PageHeader } from "../components/ui";
import AutomationsDrawer from "../components/AutomationsDrawer";
import SkillsDrawer from "../components/SkillsDrawer";
import CapabilitiesDrawer from "../components/CapabilitiesDrawer";
import { skillsIndex } from "../lib/agentSkills";
import {
  AGENT_MODES,
  getAgentMode,
  setAgentMode,
  type AgentMode,
} from "../lib/agentMode";
import {
  aiAgentStream,
  aiAutonomous,
  aiReady,
  AiError,
  buildSystemPrompt,
  getPersona,
  getAiConfig,
  type AiMessage,
  type AiImage,
} from "../lib/ai";
import {
  memoryDigest,
  listMemories,
  deleteMemory,
  clearMemories,
  type Memory,
} from "../lib/aiMemory";
import {
  setAttachment,
  setToolConfirm,
  drainFileOutputs,
} from "../lib/aiTools";
import { fileToImage } from "../lib/docScan";
import {
  loadChats,
  saveChats,
  setActiveId,
  newChat,
  resolveOpeningChat,
  deriveTitle,
  TURN_CAP,
  type Chat,
  type ChatTurn,
} from "../lib/aiChats";
import { cn } from "../lib/format";
import {
  hasDesktop as waHasDesktop,
  bridgeState,
  onBridgeState,
  type BridgeState,
} from "../lib/waBridge";

/* Claude-style full-page chat for the Filey AI agent. Conversational mode runs
 * the standard tool-calling agent; the "Autonomous" toggle hands a goal to
 * aiAutonomous (plan → act → verify → finish) and streams the steps live. */

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval. Never invent data — look it up. Be concise and practical.";

/** Four things the agent is genuinely good at, phrased the way an owner would
 *  ask. Kept short enough to fit one row on a laptop. */
const STARTERS = [
  "What did I invoice this month?",
  "Who owes me money?",
  "Draft an invoice",
  "What's running low in stock?",
];

export default function AgentChat() {
  // Fresh chat per app launch, same chat within a run — see resolveOpeningChat.
  const [chat, setChat] = useState<Chat>(resolveOpeningChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    name: string;
    args: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [memOpen, setMemOpen] = useState(false);
  const [mems, setMems] = useState<Memory[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [chatList, setChatList] = useState<Chat[]>([]);
  const [autoOpen, setAutoOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const ready = useMemo(() => aiReady(), []);
  const model = useMemo(() => getAiConfig().model, []);
  const [mode, setMode] = useState<AgentMode>(getAgentMode);
  /** What the agent is doing right now ("Looking up customers…"), shown while a
   *  tool runs so a long turn reads as work rather than as a hang. */
  const [activity, setActivity] = useState<string | null>(null);
  /** Lets the Stop button cut a run short. ponytail: on desktop the native AI
   *  proxy call itself isn't cancellable (see ai.ts), so an abort stops the
   *  agent between rounds rather than mid-request — which is what "stop doing
   *  more work" means to the person clicking it. */
  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors the streamed text for the catch block — reading the state there
   *  would get the value from the render that started the run, not the latest. */
  const streamedRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Attach a file + build an image preview (revoking the previous one).
  const attach = (f: File | null) => {
    setFilePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    });
    setFile(f);
  };

  // Auto-grow the textarea up to a cap.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  // Route the agent's sensitive-action approvals through an in-app modal
  // instead of the browser's native confirm() while this page is mounted.
  useEffect(() => {
    setToolConfirm(
      (name, args) =>
        new Promise<boolean>((resolve) => setPendingConfirm({ name, args, resolve }))
    );
    return () => {
      setToolConfirm((n) =>
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(`Allow the assistant to run "${n}"?`)
          : false
      );
    };
  }, []);

  // Persist the conversation (shared store with the popover copilot).
  useEffect(() => {
    if (!chat.turns.length) return;
    const rest = loadChats().filter((c) => c.id !== chat.id);
    saveChats([{ ...chat, title: deriveTitle(chat.turns), updatedAt: Date.now() }, ...rest]);
    setActiveId(chat.id);
  }, [chat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.turns, streaming, busy]);

  /** Stop the run. The catch in send() turns the abort into a kept partial
   *  reply rather than an error banner. */
  const stop = () => abortRef.current?.abort();

  const startNew = () => {
    const c = newChat();
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    const attached = file;
    if ((!q && !attached) || busy) return;
    if (!ready) {
      setErr("Connect an AI model first — Settings → AI Assistant (bring your own key).");
      return;
    }
    setErr(null);
    setInput("");
    attach(null); // clears the file AND revokes the preview object URL

    const shownText = attached ? `${q}${q ? "\n\n" : ""}📎 ${attached.name}` : q;
    // Explicit hint so the agent knows it can edit the attached file via tools.
    const goalText = attached
      ? `${q || "Process the attached file."}\n\n[A file named "${attached.name}" is attached — use the run_file_tool to edit/convert it, or read it to act on its contents.]`
      : q;
    const withUser: Chat = {
      ...chat,
      turns: [...chat.turns, { role: "user", text: shownText }],
    };
    setChat(withUser);
    setBusy(true);
    setStreaming(auto ? "Planning…" : "");
    const ctl = new AbortController();
    abortRef.current = ctl;

    // Make the file available to run_file_tool; convert images for vision.
    setAttachment(attached);
    let images: AiImage[] | undefined;
    if (attached && attached.type.startsWith("image/")) {
      try {
        images = [await fileToImage(attached)];
      } catch {
        /* non-fatal — the agent can still run file tools on it */
      }
    }

    try {
      let reply: string;
      if (auto) {
        const steps: string[] = [];
        const summary = await aiAutonomous(goalText, {
          images,
          isOwner: true,
          signal: ctl.signal,
          onProgress: (t) => {
            if (!t) return;
            steps.push(t);
            streamedRef.current = steps.join("\n\n");
            setStreaming(streamedRef.current);
          },
        });
        reply =
          steps.length && steps[steps.length - 1] !== summary
            ? `${steps.join("\n\n")}\n\n${summary}`
            : summary;
      } else {
        const messages: AiMessage[] = [
          {
            role: "system",
            text: buildSystemPrompt(
              SYSTEM,
              getPersona(),
              [memoryDigest(), skillsIndex()].filter(Boolean).join("\n\n")
            ),
          },
          ...withUser.turns.slice(-TURN_CAP).map((t) => ({ role: t.role, text: t.text })),
        ];
        if (images?.length) messages[messages.length - 1].images = images;
        // Streamed, not awaited whole: a turn that looks up three things and
        // drafts an invoice took a minute behind the word "Thinking…", with no
        // sign it was doing anything. The same run now narrates itself.
        const stream = aiAgentStream(messages, {
          // The harness default. 1200 truncated any answer with a table or a
          // list of invoices in it, which reads as the agent losing its thread.
          maxTokens: 2048,
          isOwner: true,
          signal: ctl.signal,
        });
        let sofar = "";
        for (;;) {
          const step = await stream.next();
          if (step.done) {
            reply = step.value;
            break;
          }
          const ev = step.value;
          if (ev.type === "text" && ev.text) {
            sofar = sofar ? `${sofar}\n\n${ev.text}` : ev.text;
            streamedRef.current = sofar;
            setStreaming(sofar);
          } else if (ev.type === "tool_call") {
            setActivity(toolLabel(ev.name));
          } else if (ev.type === "tool_result") {
            setActivity(null);
          }
        }
      }
      // Files belong to the message that produced them. They used to live in
      // one shared slot above the composer, so asking a second question threw
      // away the first answer's output.
      const made = drainFileOutputs();
      setChat((c) => ({
        ...c,
        turns: [
          ...c.turns,
          { role: "assistant", text: reply, ...(made.length ? { files: made } : {}) },
        ],
      }));
    } catch (e) {
      // A stop the user asked for is not an error. Whatever the agent had
      // already said is kept as the reply — throwing it away would punish them
      // for interrupting, which is the opposite of what the button is for.
      if (ctl.signal.aborted) {
        const partial = streamedRef.current.trim();
        setChat((c) => ({
          ...c,
          turns: [
            ...c.turns,
            { role: "assistant", text: partial ? `${partial}\n\n_Stopped._` : "_Stopped._" },
          ],
        }));
      } else {
        setErr(e instanceof AiError || e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      streamedRef.current = "";
      setBusy(false);
      setStreaming("");
      setActivity(null);
      setAttachment(null); // don't leak into the next turn
    }
  };

  const openMemory = () => {
    setMems(listMemories());
    setMemOpen(true);
  };
  const removeMem = (id: string) => {
    deleteMemory(id);
    setMems(listMemories());
  };
  const wipeMem = () => {
    clearMemories();
    setMems([]);
  };

  const openHistory = () => {
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
    setHistOpen(true);
  };
  const switchChat = (c: Chat) => {
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
    setHistOpen(false);
  };
  const deleteChat = (id: string) => {
    const next = loadChats().filter((c) => c.id !== id);
    saveChats(next);
    setChatList(next.sort((a, b) => b.updatedAt - a.updatedAt));
    if (id === chat.id) startNew();
  };

  const empty = chat.turns.length === 0;

  return (
    <div
      className="relative mx-auto flex min-h-[calc(100vh-7rem)] max-w-3xl flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) attach(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-xl border-2 border-dashed border-foreground/30 bg-background/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-foreground">
            <Paperclip size={28} />
            <p className="text-sm font-semibold text-foreground">Drop a PDF or image to attach</p>
          </div>
        </div>
      )}
      {/* Pinned: New chat, history and memory are needed most in the middle of
          a long conversation, which is exactly where they used to be scrolled
          off the top. The blur keeps message text from showing through. */}
      <div className="sticky top-0 z-30 -mx-1 bg-background/85 px-1 backdrop-blur">
      <PageHeader
        title="Filey AI"
        subtitle="Your business assistant — ask about revenue, invoices, customers and more."
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCapsOpen(true)}
              title="Capabilities — what the agent may do"
              aria-label="Capabilities"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <SlidersHorizontal size={15} />
            </button>
            <button
              type="button"
              onClick={() => setSkillsOpen(true)}
              title="Skills — reusable procedures"
              aria-label="Skills"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <BookOpen size={15} />
            </button>
            <button
              type="button"
              onClick={() => setAutoOpen(true)}
              title="Automations — scheduled tasks"
              aria-label="Automations"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <CalendarClock size={15} />
            </button>
            <button
              type="button"
              onClick={openHistory}
              title="Chat history"
              aria-label="Chat history"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <History size={15} />
            </button>
            <button
              type="button"
              onClick={openMemory}
              title="Memory — what the agent has learned"
              aria-label="Memory"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <Brain size={15} />
            </button>
            <button type="button" onClick={startNew} className="btn-ghost">
              <Plus size={14} /> New
            </button>
          </div>
        }
      />
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-6 pb-40 pt-2">
        {empty && !busy ? (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center">
              <ThinkingOrb size={64} state="listening" />
            </div>
            <p className="text-[22px] font-semibold text-foreground tracking-tight">How can I help with your business?</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Ask anything, or flip on <b>Autonomous</b> to delegate a whole task. I can read and
              act across invoices, customers, inventory, accounting and more.
            </p>
            {/* Openers, not decoration: a blank box gives no clue that this
                agent can draft documents and chase payments, not just chat. */}
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground active:scale-[0.97]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.turns.map((t, i) => <Bubble key={i} turn={t} />)
        )}

        {busy && (
          <>
            <Bubble
              turn={{ role: "assistant", text: streaming || "Thinking…" }}
              pending
            />
            {activity && (
              <div className="flex items-center gap-2 pl-11 text-[12px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                <span>{activity}</span>
              </div>
            )}
          </>
        )}

        {err && <ErrorBanner message={err} />}

        {/* Pairing QR, rendered from live bridge state rather than from the
            model's reply: a data URL is kilobytes of base64 that would bloat
            every subsequent turn's context, and the code refreshes on its own
            timer — this card follows it. */}
        <WhatsAppPairingCard />

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 -mx-1 bg-background/80 px-1 pb-4 pt-2 backdrop-blur">
        {/* Minimal composer: the border states in neutral ink, no brand accent.
            An input is not a place that needs decorating. */}
        <div className="rounded-xl border border-border bg-card p-2.5 transition-colors focus-within:border-foreground/25">
          {/* Attachment preview card */}
          {file && (
            <div className="mb-2 flex">
              <div className="group relative h-20 w-44 overflow-hidden rounded-xl border border-border bg-muted">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col justify-between p-2.5">
                    <span className="inline-flex w-fit items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      <FileText size={10} /> {file.name.split(".").pop()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {Math.max(1, Math.ceil(file.size / 1024))} KB
                      </p>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => attach(null)}
                  aria-label="Remove attachment"
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            disabled={busy}
            placeholder={auto ? "Describe a task to delegate…" : "Message Filey AI…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            // No focus ring on the composer: the global :focus-visible rule
            // paints an amber ring, and a textarea matches it on every click —
            // a yellow box around the thing you type in, all the time. Focus is
            // still shown, by the wrapper's border darkening.
            className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
            autoFocus
          />

          {/* Action bar */}
          <div className="mt-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="Attach a document"
              title="Attach a PDF or image to edit/convert with tools"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
            >
              <Plus size={18} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                attach(e.target.files?.[0] ?? null);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
            {model && (
              <span
                className="hidden items-center rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex"
                title="Model is configured in Settings → AI Assistant"
              >
                {model}
              </span>
            )}
            {/* Right of the model name: how much the agent may do without
                asking. It belongs next to the model because both answer the
                same question — what is about to act on your data. */}
            <select
              value={mode}
              onChange={(e) => {
                const v = e.target.value as AgentMode;
                setAgentMode(v);
                setMode(v);
              }}
              aria-label="Agent mode"
              title={AGENT_MODES.find((m) => m.id === mode)?.description}
              className="rounded-lg border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {AGENT_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {/* Autonomous belongs here, not in the page header: it changes what
                pressing Enter will do, so it sits with the thing you press. */}
            <button
              type="button"
              onClick={() => setAuto((v) => !v)}
              aria-pressed={auto}
              title="Autonomous mode: hand the agent a goal and it plans, acts and verifies on its own."
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors active:scale-[0.97]",
                auto
                  ? "bg-primary-400/15 text-foreground"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              <Zap size={13} className={auto ? "text-primary-600 dark:text-primary-400" : ""} />
              {auto ? "Autonomous" : "Chat"}
            </button>
            <div className="flex-1" />
            {busy ? (
              // Square, because that is what stop looks like everywhere else.
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                title="Stop"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-80"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={!input.trim() && !file}
                aria-label="Send"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
          {auto
            ? "Autonomous: the agent runs multiple steps on its own. Money/outbound actions still ask first."
            : "Tip: turn on Autonomous to delegate a whole task. Enter to send · Shift+Enter for a new line."}
        </p>
      </div>

      {/* Sensitive-action approval (replaces the native confirm dialog).
          Portaled, like the two overlays below it: this page renders inside
          <main>, and WebView2 composites a `fixed` overlay into its scrolling
          ancestor's layer and then repaints only part of it. */}
      {pendingConfirm && createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-warning" />
              <p className="font-semibold text-foreground">Approve action</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The assistant wants to run{" "}
              <b className="text-foreground">{pendingConfirm.name}</b>. This can change data
              or send something out.
            </p>
            {Object.keys(pendingConfirm.args).length > 0 && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
                {JSON.stringify(pendingConfirm.args, null, 2)}
              </pre>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  pendingConfirm.resolve(false);
                  setPendingConfirm(null);
                }}
              >
                Deny
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  pendingConfirm.resolve(true);
                  setPendingConfirm(null);
                }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Memory viewer */}
      {memOpen && createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setMemOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-primary-500" />
                <p className="font-semibold text-foreground">Agent memory</p>
              </div>
              <button
                onClick={() => setMemOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            {mems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing learned yet. The agent saves durable facts and preferences
                here as you chat.
              </p>
            ) : (
              <div className="max-h-[50vh] space-y-2 overflow-auto">
                {mems.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      {m.tag && (
                        <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {m.tag}
                        </span>
                      )}
                      <span className="text-sm text-foreground">{m.text}</span>
                    </div>
                    <button
                      onClick={() => removeMem(m.id)}
                      aria-label="Forget"
                      className="shrink-0 text-muted-foreground hover:text-danger"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {mems.length > 0 && (
              <div className="mt-4 flex justify-end">
                <button
                  className="btn-ghost text-danger"
                  onClick={wipeMem}
                >
                  Clear all memory
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {/* Chat history drawer */}
      {histOpen && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/40"
          role="dialog"
          aria-modal="true"
          onClick={() => setHistOpen(false)}
        >
          <div
            className="absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-r border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="font-semibold text-foreground">Chats</p>
              <button
                onClick={() => setHistOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <button
              onClick={() => {
                startNew();
                setHistOpen(false);
              }}
              className="m-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-hover"
            >
              <Plus size={15} /> New chat
            </button>
            <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
              {chatList.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No chats yet.
                </p>
              ) : (
                chatList.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => switchChat(c)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors",
                      c.id === chat.id
                        ? "bg-primary-400/15"
                        : "hover:bg-hover"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {c.title || "New chat"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(c.id);
                      }}
                      aria-label="Delete chat"
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      <AutomationsDrawer open={autoOpen} onClose={() => setAutoOpen(false)} />
      <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <CapabilitiesDrawer open={capsOpen} onClose={() => setCapsOpen(false)} />
    </div>
  );
}

/** Copy a reply. Shows "Copied" for a moment — without that the click has no
 *  visible result at all and people click it twice. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => {
            /* clipboard blocked — nothing useful to say about it */
          }
        );
      }}
      aria-label="Copy reply"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Tool name → something a business owner recognises. Unknown tools fall back
 *  to their own name with the underscores taken out, which reads well enough
 *  that new tools need no entry here to be presentable. */
function toolLabel(name: string): string {
  const known: Record<string, string> = {
    create_invoice_draft: "Drafting the invoice",
    create_quote: "Drafting the quote",
    create_purchase_order: "Drafting the purchase order",
    create_customer: "Adding the customer",
    create_product: "Adding the product",
    adjust_stock: "Updating stock",
    log_expense: "Logging the expense",
    send_invoice: "Sending the invoice",
    email_invoice: "Emailing the invoice",
    mark_invoice_paid: "Marking it paid",
    get_stats: "Checking the numbers",
    find_customers: "Looking up customers",
    find_products: "Looking up products",
    find_invoices: "Looking up invoices",
    list_whatsapp_messages: "Reading WhatsApp",
    send_whatsapp: "Sending on WhatsApp",
    read_web_page: "Reading the page",
    search_web: "Searching the web",
    recall: "Checking what I remember",
    remember: "Saving that for later",
    run_file_tool: "Working on the file",
  };
  return known[name] ?? `${name.replace(/_/g, " ")}…`;
}

function Bubble({ turn, pending }: { turn: ChatTurn; pending?: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-foreground px-3.5 py-2.5 text-[13px] leading-relaxed text-background">
          {turn.text}
        </div>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <User size={15} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      {/* The orb is the assistant's face, so it stays alive whatever the agent
          is doing — working while a turn is in flight, listening once it has
          answered. */}
      <div className="grid h-8 w-8 shrink-0 place-items-center">
        <ThinkingOrb size={20} state={pending ? "working" : "listening"} />
      </div>
      <div className="group/msg min-w-0 max-w-[85%]">
        <div
          className={cn(
            "rounded-lg border border-border bg-hover px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground",
            pending && "text-muted-foreground"
          )}
        >
          {/* Markdown, not raw text: the model writes **bold**, bullets and
              fenced code, and every one of those used to show as punctuation. */}
          <Markdown text={turn.text} />
          {pending && <span className="ml-1 inline-block animate-pulse">▍</span>}
        </div>
        {!pending && turn.text.trim() && (
          <div className="mt-1 flex opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
            <CopyButton text={turn.text} />
          </div>
        )}
        {!!turn.files?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {turn.files.map((f, i) =>
              // Desktop: the file is already on disk, so open it where it
              // landed. Browser: hand over the blob as a real download.
              f.path ? (
                <button
                  key={i}
                  type="button"
                  title={f.path}
                  onClick={() => void openFolder(f.path!)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
                >
                  <FolderOpen size={12} />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                </button>
              ) : f.url ? (
                <a
                  key={i}
                  href={f.url}
                  download={f.name}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
                >
                  <Download size={12} />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                </a>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** WhatsApp pairing QR, shown in the conversation while one is live. Driven by
 *  the bridge supervisor, so it appears when the agent starts the bridge and
 *  disappears the moment the code is scanned or spent. */
function WhatsAppPairingCard() {
  const [st, setSt] = useState<BridgeState>({ state: "stopped" });

  useEffect(() => {
    if (!waHasDesktop) return;
    void bridgeState().then(setSt);
    return onBridgeState(setSt);
  }, []);

  if (!st.qr && st.state !== "connected") return null;

  if (st.state === "connected") {
    return (
      <div className="flex gap-3">
        <div className="h-8 w-8 shrink-0" />
        <div className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-foreground">
          ✅ WhatsApp is connected. Message that number and I'll answer there.
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 shrink-0" />
      <div className="rounded-lg border border-border bg-card p-3.5">
        <p className="mb-2 text-[13px] font-medium text-foreground">
          Scan to connect WhatsApp
        </p>
        <img
          src={st.qr!}
          alt="WhatsApp pairing QR code"
          className="h-44 w-44 rounded bg-white p-1"
        />
        <p className="mt-2 max-w-[15rem] text-[12px] text-muted-foreground">
          On your phone: WhatsApp → Settings → <b>Linked devices</b> → Link a
          device. The code refreshes on its own if it expires.
        </p>
      </div>
    </div>
  );
}
