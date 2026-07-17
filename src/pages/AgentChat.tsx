import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Loader2,
  Zap,
  Sparkles,
  AlertTriangle,
  Paperclip,
  X,
  Download,
  Brain,
  Trash2,
  ShieldAlert,
  ArrowUp,
  FileText,
  History,
  CalendarClock,
  BookOpen,
  SlidersHorizontal,
} from "lucide-react";
import AutomationsDrawer from "../components/AutomationsDrawer";
import SkillsDrawer from "../components/SkillsDrawer";
import CapabilitiesDrawer from "../components/CapabilitiesDrawer";
import { skillsIndex } from "../lib/agentSkills";
import {
  aiAgent,
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
  type FileOutput,
} from "../lib/aiTools";
import { fileToImage } from "../lib/docScan";
import {
  loadChats,
  saveChats,
  getActiveId,
  setActiveId,
  newChat,
  deriveTitle,
  TURN_CAP,
  type Chat,
  type ChatTurn,
} from "../lib/aiChats";
import { cn } from "../lib/format";

/* Claude-style full-page chat for the Filey AI agent. Conversational mode runs
 * the standard tool-calling agent; the "Autonomous" toggle hands a goal to
 * aiAutonomous (plan → act → verify → finish) and streams the steps live. */

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval. Never invent data — look it up. Be concise and practical.";

const SUGGESTIONS = [
  "What's overdue right now?",
  "Draft an invoice for Acme: 10 widgets at 25 AED",
  "Remember our VAT is 5% and we bill in AED",
  "Which products are low on stock?",
];

export default function AgentChat() {
  const [chat, setChat] = useState<Chat>(() => {
    const all = loadChats();
    return all.find((c) => c.id === getActiveId()) ?? all[0] ?? newChat();
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [outputs, setOutputs] = useState<FileOutput[]>([]);
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
    setOutputs([]);

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
          onProgress: (t) => {
            if (!t) return;
            steps.push(t);
            setStreaming(steps.join("\n\n"));
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
        reply = await aiAgent(messages, { maxTokens: 1200 });
      }
      setChat((c) => ({ ...c, turns: [...c.turns, { role: "assistant", text: reply }] }));
      setOutputs(drainFileOutputs());
    } catch (e) {
      setErr(e instanceof AiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStreaming("");
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
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-primary-400 bg-canvas/85 backdrop-blur-sm dark:bg-background/85">
          <div className="flex flex-col items-center gap-2 text-primary-600">
            <Paperclip size={28} />
            <p className="text-sm font-semibold text-ink">Drop a PDF or image to attach</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary-500" />
          <h1 className="text-lg font-semibold text-ink">Filey AI</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCapsOpen(true)}
            title="Capabilities — what the agent may do"
            aria-label="Capabilities"
            className="grid h-9 w-9 place-items-center rounded-full border border-brand-200 text-brand-500 transition-colors hover:bg-brand-50 hover:text-ink dark:hover:bg-white/10"
          >
            <SlidersHorizontal size={15} />
          </button>
          <button
            type="button"
            onClick={() => setSkillsOpen(true)}
            title="Skills — reusable procedures"
            aria-label="Skills"
            className="grid h-9 w-9 place-items-center rounded-full border border-brand-200 text-brand-500 transition-colors hover:bg-brand-50 hover:text-ink dark:hover:bg-white/10"
          >
            <BookOpen size={15} />
          </button>
          <button
            type="button"
            onClick={() => setAutoOpen(true)}
            title="Automations — scheduled tasks"
            aria-label="Automations"
            className="grid h-9 w-9 place-items-center rounded-full border border-brand-200 text-brand-500 transition-colors hover:bg-brand-50 hover:text-ink dark:hover:bg-white/10"
          >
            <CalendarClock size={15} />
          </button>
          <button
            type="button"
            onClick={openHistory}
            title="Chat history"
            aria-label="Chat history"
            className="grid h-9 w-9 place-items-center rounded-full border border-brand-200 text-brand-500 transition-colors hover:bg-brand-50 hover:text-ink dark:hover:bg-white/10"
          >
            <History size={15} />
          </button>
          <button
            type="button"
            onClick={openMemory}
            title="Memory — what the agent has learned"
            aria-label="Memory"
            className="grid h-9 w-9 place-items-center rounded-full border border-brand-200 text-brand-500 transition-colors hover:bg-brand-50 hover:text-ink dark:hover:bg-white/10"
          >
            <Brain size={15} />
          </button>
          <button
            type="button"
            onClick={() => setAuto((v) => !v)}
            title="Autonomous mode: hand the agent a goal and it plans, acts and verifies on its own."
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              auto
                ? "border-primary-400 bg-primary-100 text-ink dark:bg-primary-400/15"
                : "border-brand-200 bg-white text-brand-600 hover:bg-brand-50 dark:bg-white/5 dark:hover:bg-white/10"
            )}
          >
            <Zap size={13} className={auto ? "text-primary-600" : ""} />
            {auto ? "Autonomous" : "Chat"}
          </button>
          <button type="button" onClick={startNew} className="btn-ghost h-9 px-3 text-xs">
            <Plus size={14} /> New
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-6 pb-40 pt-2">
        {empty && !busy ? (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <p className="text-2xl font-semibold text-ink">How can I help with your business?</p>
            <p className="mt-2 text-sm text-brand-500">
              Ask anything, or flip on <b>Autonomous</b> to delegate a whole task. I can read and
              act across invoices, customers, inventory, accounting and more.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-brand-200 bg-white px-3.5 py-2.5 text-left text-sm text-brand-700 transition-colors hover:border-primary-300 hover:bg-brand-50 dark:bg-white/5 dark:hover:bg-white/10"
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
          <Bubble
            turn={{ role: "assistant", text: streaming || "Thinking…" }}
            pending
          />
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 -mx-1 bg-canvas/80 px-1 pb-4 pt-2 backdrop-blur dark:bg-background/80">
        {outputs.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-brand-400">Generated:</span>
            {outputs.map((o, i) => (
              <a
                key={i}
                href={o.url}
                download={o.name}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:border-primary-300 hover:bg-brand-50 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <Download size={12} />
                <span className="max-w-[180px] truncate">{o.name}</span>
              </a>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-brand-200 bg-white p-2.5 shadow-bento transition-shadow focus-within:border-primary-400 focus-within:shadow-bento-hover">
          {/* Attachment preview card */}
          {file && (
            <div className="mb-2 flex">
              <div className="group relative h-20 w-44 overflow-hidden rounded-xl border border-brand-200 bg-brand-50 dark:bg-white/5">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col justify-between p-2.5">
                    <span className="inline-flex w-fit items-center gap-1 rounded bg-brand-200/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-600 dark:bg-white/10">
                      <FileText size={10} /> {file.name.split(".").pop()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[10px] text-brand-400">
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
            className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-brand-400"
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
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-brand-400 transition-colors hover:bg-brand-50 hover:text-ink disabled:opacity-40 dark:hover:bg-white/10"
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
                className="hidden items-center rounded-lg px-2 py-1 text-[11px] font-medium text-brand-400 sm:inline-flex"
                title="Model is configured in Settings → AI Assistant"
              >
                {model}
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || (!input.trim() && !file)}
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-400 text-ink transition-colors hover:bg-primary-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
        <p className="mt-1.5 px-2 text-[11px] text-brand-400">
          {auto
            ? "Autonomous: the agent runs multiple steps on its own. Money/outbound actions still ask first."
            : "Tip: turn on Autonomous to delegate a whole task. Enter to send · Shift+Enter for a new line."}
        </p>
      </div>

      {/* Sensitive-action approval (replaces the native confirm dialog) */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-bento">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-warning" />
              <p className="font-semibold text-ink">Approve action</p>
            </div>
            <p className="mt-2 text-sm text-brand-600">
              The assistant wants to run{" "}
              <b className="text-ink">{pendingConfirm.name}</b>. This can change data
              or send something out.
            </p>
            {Object.keys(pendingConfirm.args).length > 0 && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-brand-50 p-2.5 text-[11px] text-brand-600 dark:bg-white/5">
                {JSON.stringify(pendingConfirm.args, null, 2)}
              </pre>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn-ghost h-9 px-4 text-sm"
                onClick={() => {
                  pendingConfirm.resolve(false);
                  setPendingConfirm(null);
                }}
              >
                Deny
              </button>
              <button
                className="btn-primary h-9 px-4 text-sm"
                onClick={() => {
                  pendingConfirm.resolve(true);
                  setPendingConfirm(null);
                }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Memory viewer */}
      {memOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setMemOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-bento"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-primary-500" />
                <p className="font-semibold text-ink">Agent memory</p>
              </div>
              <button
                onClick={() => setMemOpen(false)}
                aria-label="Close"
                className="text-brand-400 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            {mems.length === 0 ? (
              <p className="py-6 text-center text-sm text-brand-500">
                Nothing learned yet. The agent saves durable facts and preferences
                here as you chat.
              </p>
            ) : (
              <div className="max-h-[50vh] space-y-2 overflow-auto">
                {mems.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start gap-2 rounded-lg border border-brand-200 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      {m.tag && (
                        <span className="mr-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-600 dark:bg-white/10">
                          {m.tag}
                        </span>
                      )}
                      <span className="text-sm text-ink">{m.text}</span>
                    </div>
                    <button
                      onClick={() => removeMem(m.id)}
                      aria-label="Forget"
                      className="shrink-0 text-brand-400 hover:text-danger"
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
                  className="btn-ghost h-9 px-4 text-sm text-danger"
                  onClick={wipeMem}
                >
                  Clear all memory
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Chat history drawer */}
      {histOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          role="dialog"
          aria-modal="true"
          onClick={() => setHistOpen(false)}
        >
          <div
            className="absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-bento"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
              <p className="font-semibold text-ink">Chats</p>
              <button
                onClick={() => setHistOpen(false)}
                aria-label="Close"
                className="text-brand-400 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <button
              onClick={() => {
                startNew();
                setHistOpen(false);
              }}
              className="m-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:hover:bg-white/10"
            >
              <Plus size={15} /> New chat
            </button>
            <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
              {chatList.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-brand-500">
                  No chats yet.
                </p>
              ) : (
                chatList.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => switchChat(c)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition-colors",
                      c.id === chat.id
                        ? "bg-primary-100 dark:bg-primary-400/15"
                        : "hover:bg-brand-50 dark:hover:bg-white/5"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {c.title || "New chat"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(c.id);
                      }}
                      aria-label="Delete chat"
                      className="shrink-0 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <AutomationsDrawer open={autoOpen} onClose={() => setAutoOpen(false)} />
      <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <CapabilitiesDrawer open={capsOpen} onClose={() => setCapsOpen(false)} />
    </div>
  );
}

function Bubble({ turn, pending }: { turn: ChatTurn; pending?: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary-100 px-4 py-2.5 text-sm text-ink dark:bg-primary-400/15">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-white">
        <Sparkles size={14} />
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap pt-1 text-sm leading-relaxed text-ink",
          pending && "text-brand-500"
        )}
      >
        {turn.text}
        {pending && <span className="ml-1 inline-block animate-pulse">▍</span>}
      </div>
    </div>
  );
}
