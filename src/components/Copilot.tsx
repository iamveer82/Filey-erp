import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send,
  X,
  Plus,
  NotepadText,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  Paperclip,
} from "lucide-react";
import { cn, fmtDate } from "../lib/format";
import {
  aiAgent,
  aiReady,
  AiError,
  getPersona,
  setPersona,
  buildSystemPrompt,
  AI_VIBES,
  ORB_PRESETS,
  type AiMessage,
  type AiPersona,
  type AiVibe,
} from "../lib/ai";
import {
  loadChats,
  saveChats,
  setActiveId,
  newChat,
  resolveOpeningChat,
  deriveTitle,
  transcript,
  TURN_CAP,
  type Chat,
  type ChatTurn,
} from "../lib/aiChats";
import { buildAiContext } from "../lib/aiContext";
import { memoryDigest } from "../lib/aiMemory";
import {
  setTurnFile,
  endTurn,
  type FileOutput,
} from "../lib/aiTools";
import { fileToImage } from "../lib/docScan";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { MenuPopover, MenuItemRow, SelectMenu } from "./ui-menu";
import BloubBot from "./BloubBot";
import ThinkingDots from "./ThinkingDots";
import { botExpressionFor, botStateFor } from "../lib/botMood";

const SYSTEM =
  "You are Filey, a powerful ERP agent with FULL control of the user's business app. You can READ, CREATE, and MODIFY data via tools — not just chat. Available actions: get stats (customers, products, invoices, orders, quotes, overdue); search customers and products; list invoices by status; list employees; create customers, products, quotes, purchase orders, and draft invoices; adjust stock; log expenses; mark invoices sent/paid/recurring; mark employee attendance (present/absent/half_day/leave); email invoices to customers; run PDF/image operations on attached files (compress, convert, rotate, OCR, merge); navigate to any app page. When the user asks you to DO something, execute the tool and confirm what you did in one short line. For destructive or ambiguous requests, ask first. Never invent data — look it up. Be concise and practical.";

/** Quick-start prompts shown in an empty chat. */
const SUGGESTIONS = [
  "Draft an invoice",
  "What's overdue?",
  "Add a new customer",
  "What's low on stock?",
];


type View = "chat" | "history";

export default function Copilot() {
  const { profile } = useAuth();
  const { toast, confirm, prompt } = useUI();
  const [open, setOpen] = useState(false);
  // Same rule as the full page: a fresh chat per app launch, the one you were
  // using for the rest of the run. Seeded into the list too — a brand-new chat
  // has no turns, so it isn't in storage yet and would otherwise be missing.
  const [opening] = useState(resolveOpeningChat);
  const [chats, setChats] = useState<Chat[]>(() => {
    const all = loadChats();
    return all.some((c) => c.id === opening.id) ? all : [opening, ...all];
  });
  const [activeId, setActiveIdState] = useState<string | null>(opening.id);
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [persona, setPersonaState] = useState<AiPersona>(getPersona);
  const [ctx, setCtx] = useState<string>("");
  const [customizing, setCustomizing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [file, setFile] = useState<File | null>(null);
  const ready = aiReady();
  const navigate = useNavigate();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (patch: Partial<AiPersona>) => setPersonaState(setPersona(patch));
  // Mirror for async reads: send() needs the latest list after an await, and
  // building the next state from the mirror keeps the setChats call pure (the
  // localStorage write used to run inside the updater — a side effect React
  // forbids, doubled under StrictMode).
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  // toast is recreated each render — read it through a ref so persist/select
  // can be stable useCallbacks.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const persist = useCallback((next: Chat[]) => {
    chatsRef.current = next;
    setChats(next);
    if (!saveChats(next))
      toastRef.current?.error("Chat history couldn't be saved - browser storage is full.");
  }, []);
  const select = useCallback((id: string | null) => {
    setActiveIdState(id);
    setActiveId(id);
  }, []);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const turns = active?.turns ?? [];
  const needsOnboarding = ready && !persona.onboarded;

  const [draft, setDraft] = useState({
    userName: persona.userName || profile?.name?.split(" ")[0] || "",
    role: persona.role || "",
    vibe: persona.vibe as AiVibe,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open && ready && persona.onboarded && view === "chat")
      timer = setTimeout(() => taRef.current?.focus(), 60);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [open, ready, persona.onboarded, view]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    if (open && ready && persona.onboarded && !ctx)
      buildAiContext(profile?.company)
        .then(setCtx)
        .catch((e) => console.error("Failed to build AI context:", e));
  }, [open, ready, persona.onboarded, ctx, profile?.company]);
  // PWA: the app shell works offline, but the AI needs to reach the model.
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  // Other parts of the app can pop Filey open via a CustomEvent.
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("filey:copilot:open", h);
    return () => window.removeEventListener("filey:copilot:open", h);
  }, []);

  const finishOnboarding = () => {
    const p = setPersona({
      userName: draft.userName.trim(),
      role: draft.role.trim(),
      vibe: draft.vibe,
      onboarded: true,
    });
    setPersonaState(p);
    const c = newChat();
    c.title = "Welcome";
    c.turns = [
      {
        role: "assistant",
        text: `Hi${p.userName ? ` ${p.userName}` : ""}! I'm ${p.assistantName || "Filey"}. I can see your customers, invoices, products and more - ask me to draft an invoice line, a customer email, a summary, or anything about your business.`,
      },
    ];
    persist([c, ...chats]);
    select(c.id);
    setView("chat");
  };

  const startNewChat = () => {
    const c = newChat();
    persist([c, ...chats]);
    select(c.id);
    setView("chat");
    setInput("");
    setErr(null);
  };

  const send = useCallback(async () => {
    const text = input.trim() || (file ? "Process the attached file." : "");
    if (!text || busy) return;
    if (!navigator.onLine) {
      setErr("You're offline - Filey AI needs a connection to reach your model.");
      return;
    }
    setErr(null);

    let id = activeId;
    let base = chats;
    if (!id || !chats.find((c) => c.id === id)) {
      const c = newChat();
      base = [c, ...chats];
      id = c.id;
      select(id);
    }
    const userTurn: ChatTurn = {
      role: "user",
      text: file ? `📎 ${file.name}\n${text}` : text,
    };
    const afterUser = base.map((c) =>
      c.id === id
        ? {
            ...c,
            turns: [...c.turns, userTurn],
            updatedAt: Date.now(),
            title:
              c.title === "New chat" || !c.title
                ? deriveTitle([...c.turns, userTurn])
                : c.title,
          }
        : c
    );
    persist(afterUser);
    setInput("");
    setBusy(true);
    // This turn's slot in the file toolbox: attachment in, produced files out.
    // Keyed per turn — the full-page agent can be mid-run at the same time, and
    // the two used to share one module-global file.
    const turnId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    setTurnFile(turnId, file);
    const attached = file;
    const convo = afterUser.find((c) => c.id === id)?.turns ?? [];
    /** Append an assistant turn to chat `id` from the mirror and persist. */
    const appendReply = (text: string, files?: FileOutput[]) => {
      const next = chatsRef.current.map((c) =>
        c.id === id
          ? {
              ...c,
              turns: [
                ...c.turns,
                { role: "assistant" as const, text, ...(files?.length ? { files } : {}) },
              ],
              updatedAt: Date.now(),
            }
          : c
      );
      persist(next);
    };
    try {
      const messages: AiMessage[] = [
        {
          role: "system",
          text: buildSystemPrompt(
            SYSTEM,
            getPersona(),
            [ctx, memoryDigest()].filter(Boolean).join("\n\n")
          ),
        },
        ...convo.slice(-TURN_CAP).map((t) => ({ role: t.role, text: t.text })),
      ];
      if (attached && attached.type.startsWith("image/")) {
        try {
          messages[messages.length - 1].images = [await fileToImage(attached)];
        } catch (e) {
          /* vision optional */
          console.warn("Failed to attach image for AI vision:", e);
        }
      }
      const reply = await aiAgent(messages, { maxTokens: 900, turnId });
      appendReply(reply || "(no response)", endTurn(turnId));
    } catch (e) {
      setErr(
        e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e)
      );
      endTurn(turnId); // never leak into the next turn's reply
      // The user turn is already on screen; a bare question with no answer and
      // no marker reads as "seen but ignored". Mark the failure instead.
      appendReply("(no reply — the request failed. Resend to try again.)");
    } finally {
      setBusy(false);
      setFile(null);
    }
  }, [input, busy, chats, activeId, ctx, file, persist, select]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape") setOpen(false);
  };

  const renameChat = async (c: Chat) => {
    const name = await prompt({
      title: "Rename chat",
      defaultValue: c.title,
      confirmLabel: "Save",
    });
    if (name != null)
      persist(
        chats.map((x) => (x.id === c.id ? { ...x, title: name.trim() || x.title } : x))
      );
  };
  const shareChat = async (c: Chat) => {
    try {
      await navigator.clipboard.writeText(transcript(c));
      toast.success("Conversation copied to clipboard");
    } catch (e) {
      toast.error("Couldn't copy");
      console.warn("Failed to copy chat transcript:", e);
    }
  };
  const deleteChat = async (c: Chat) => {
    const ok = await confirm({
      title: "Delete this chat?",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const next = chats.filter((x) => x.id !== c.id);
    persist(next);
    if (activeId === c.id) select(next[0]?.id ?? null);
  };

  const bubble = (role: ChatTurn["role"]) =>
    role === "user"
      ? "ml-auto rounded-br-sm bg-primary-400 text-ink"
      : "mr-auto rounded-bl-sm bg-brand-50 text-ink dark:bg-white/8";

  return (
    <div className="no-print fixed bottom-5 right-5 z-[60] flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[min(70vh,520px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-xl border border-brand-200 bg-white">
          {/* header */}
          <div className="flex items-center gap-2 border-b border-brand-100 px-3 py-3">
            <button
              onClick={() => setCustomizing((c) => !c)}
              aria-label="Customize assistant"
              title="Click to rename & recolour"
              className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <BloubBot
                size={44}
                animate={busy}
                ambient
                state={botStateFor(busy ? "thinking" : "idle")}
                expression={botExpressionFor(busy ? "thinking" : "idle")}
              />
            </button>
            <span className="truncate text-sm font-medium text-ink">
              {view === "history" ? "Chats" : persona.assistantName || "Filey"}
            </span>
            {ready && persona.onboarded && (
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={startNewChat}
                  aria-label="New chat"
                  title="New chat"
                  className="rounded-xl p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 cursor-pointer"
                >
                  <Plus size={16} />
                </button>
                <button
                  onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
                  aria-label="History"
                  title="Chat history"
                  className={cn(
                    "rounded-xl p-1.5 cursor-pointer hover:bg-brand-50 dark:hover:bg-white/5",
                    view === "history"
                      ? "text-ink"
                      : "text-brand-400 hover:text-ink"
                  )}
                >
                  <NotepadText size={16} />
                </button>
              </div>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className={cn(
                "rounded-xl p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 cursor-pointer",
                !(ready && persona.onboarded) && "ml-auto"
              )}
            >
              <X size={16} />
            </button>
          </div>

          {/* customizer */}
          {customizing && (
            <div className="overflow-hidden border-b border-brand-100">
              <div className="space-y-2.5 px-4 py-3">
                <div className="field">
                  <label className="label">Assistant name</label>
                  <input
                    className="input h-9"
                    value={persona.assistantName}
                    onChange={(e) => save({ assistantName: e.target.value })}
                    placeholder="Filey"
                  />
                </div>
                <div>
                  <p className="label">Orb colour</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ORB_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => save({ orbColor: c })}
                        aria-label={`Colour ${c}`}
                        className={cn(
                          "h-6 w-6 cursor-pointer rounded-full border border-black/10",
                          persona.orbColor.toLowerCase() === c.toLowerCase() &&
                            "ring-2 ring-ink ring-offset-1 dark:ring-offset-background"
                        )}
                        style={{ background: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={persona.orbColor}
                      onChange={(e) => save({ orbColor: e.target.value })}
                      aria-label="Custom colour"
                      title="Custom colour"
                      className="h-6 w-8 cursor-pointer rounded border border-brand-200 bg-transparent"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setCustomizing(false)}
                  className="btn-ghost h-8 w-full"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* body */}
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {!ready ? (
              <div className="space-y-3 text-sm text-brand-500">
                <p>
                  Connect your own AI model to begin. Filey never sees your key - it stays
                  in this browser and talks to your provider directly.
                </p>
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate("/settings?section=ai");
                  }}
                  className="btn-primary h-9"
                >
                  Connect a model
                </button>
              </div>
            ) : needsOnboarding ? (
              <div className="space-y-3">
                <p className="text-sm text-brand-500">
                  Hi! I'm Filey. A couple of quick things so I can help you better - I'll
                  remember these.
                </p>
                <div className="field">
                  <label className="label">What should I call you?</label>
                  <input
                    className="input"
                    value={draft.userName}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, userName: e.target.value }))
                    }
                    placeholder="Your name"
                  />
                </div>
                <div className="field">
                  <label className="label">Your role / post</label>
                  <input
                    className="input"
                    value={draft.role}
                    onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                    placeholder="e.g. Owner, Accountant, Sales"
                  />
                </div>
                <div className="field">
                  <label className="label">Pick a vibe</label>
                  <SelectMenu
                    value={draft.vibe}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, vibe: v as AiVibe }))
                    }
                    options={AI_VIBES.map((v) => ({ value: v, label: v }))}
                  />
                </div>
                <button onClick={finishOnboarding} className="btn-primary w-full">
                  Start
                </button>
              </div>
            ) : view === "history" ? (
              chats.length === 0 ? (
                <p className="text-sm text-brand-400">No conversations yet.</p>
              ) : (
                <div className="space-y-1">
                  {chats.map((c) => (
                    <div key={c.id} className="relative">
                      <button
                        onClick={() => {
                          select(c.id);
                          setView("chat");
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors cursor-pointer hover:bg-brand-50 dark:hover:bg-white/5",
                          c.id === activeId && "bg-brand-50 dark:bg-white/8"
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {c.title}
                          </span>
                          <span className="block text-[11px] text-brand-400">
                            {fmtDate(new Date(c.updatedAt).toISOString())} ·{" "}
                            {c.turns.length} msgs
                          </span>
                        </span>
                      </button>
                      {/* Sibling of the row button (never nested inside it):
                          a button inside a button is invalid HTML. */}
                      <div className="absolute right-1 top-2">
                        <ChatOptionsMenu
                          onRename={() => void renameChat(c)}
                          onShare={() => void shareChat(c)}
                          onDelete={() => void deleteChat(c)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : turns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-brand-400">
                  Ask me to draft an invoice line, a customer email, a product
                  description, or anything about your business.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        taRef.current?.focus();
                      }}
                      className="chip cursor-pointer hover:bg-brand-100 dark:hover:bg-white/10"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-relaxed",
                    bubble(t.role)
                  )}
                >
                  {t.text}
                </div>
              ))
            )}
            {busy && view === "chat" && (
              <div className="mr-auto w-fit rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-400 dark:bg-white/8">
                <ThinkingDots />
              </div>
            )}
            {err && view === "chat" && (
              <div className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
                {err}
              </div>
            )}
          </div>

          {/* input */}
          {ready && persona.onboarded && view === "chat" && (
            <div className="border-t border-brand-100 p-2.5">
              {!online && (
                <p className="mb-2 rounded-xl bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning">
                  You're offline - Filey AI will reconnect automatically.
                </p>
              )}
              {file && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-brand-50 px-2.5 py-1.5 text-xs dark:bg-white/8">
                  <Paperclip size={13} className="shrink-0 text-brand-400" />
                  <span className="flex-1 truncate text-ink">{file.name}</span>
                  <button
                    onClick={() => setFile(null)}
                    aria-label="Remove file"
                    className="cursor-pointer text-brand-400 hover:text-danger"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach a PDF or image"
                  title="Attach a PDF or image"
                  className="grid h-10 w-9 shrink-0 place-items-center rounded-xl text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 cursor-pointer"
                >
                  <Paperclip size={17} />
                </button>
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                  placeholder={online ? "Ask Filey AI… (⌘/Ctrl+Enter)" : "Offline…"}
                  className="textarea max-h-32 min-h-[40px] flex-1 py-2"
                />
                <button
                  onClick={() => void send()}
                  disabled={busy || (!input.trim() && !file) || !online}
                  aria-label="Send"
                  className="btn-primary h-10 w-10 shrink-0 !px-0"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Filey AI assistant"
        className="flex h-16 cursor-pointer items-center gap-2 rounded-full border border-brand-200 bg-white pl-2 pr-4 hover:bg-brand-50 dark:hover:bg-white/5 transition-colors"
      >
        {/* The launcher is the assistant's presence on every page, so it stays
            alive: one loop for the whole app, and it stops on its own for
            anyone who asked for reduced motion. */}
        <BloubBot size={64} state="idle" ambient />
        <span className="text-sm font-medium text-ink">Ask AI</span>
      </button>
    </div>
  );
}

/** Per-chat options (rename / share / delete) in the history list — the app's
 *  one menu primitive, anchored to the row's ⋯ button. */
function ChatOptionsMenu({
  onRename,
  onShare,
  onDelete,
}: {
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        aria-label="Chat options"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-xl p-1 text-brand-400 hover:bg-brand-100 hover:text-ink dark:hover:bg-white/10 cursor-pointer"
      >
        <MoreHorizontal size={16} />
      </button>
      <MenuPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        align="end"
        className="w-36"
      >
        <MenuItemRow
          icon={<Pencil size={14} />}
          label="Rename"
          onClick={() => run(onRename)}
        />
        <MenuItemRow
          icon={<Share2 size={14} />}
          label="Share"
          onClick={() => run(onShare)}
        />
        <MenuItemRow
          danger
          icon={<Trash2 size={14} />}
          label="Delete"
          onClick={() => run(onDelete)}
        />
      </MenuPopover>
    </>
  );
}
