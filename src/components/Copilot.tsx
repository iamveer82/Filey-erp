import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Send, X, Plus, NotepadText, MoreHorizontal, Pencil, Share2, Trash2, Paperclip } from "lucide-react";
import { cn, fmtDate } from "../lib/format";
import {
  aiAgent,
  aiReady,
  AiError,
  getPersona,
  setPersona,
  buildSystemPrompt,
  AI_VIBES,
  type AiMessage,
  type AiPersona,
  type AiVibe,
} from "../lib/ai";
import {
  loadChats,
  saveChats,
  getActiveId,
  setActiveId,
  newChat,
  deriveTitle,
  transcript,
  TURN_CAP,
  type Chat,
  type ChatTurn,
} from "../lib/aiChats";
import { buildAiContext } from "../lib/aiContext";
import { setAttachment } from "../lib/aiTools";
import { fileToImage } from "../lib/docScan";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import ColorOrb from "./ColorOrb";

const SYSTEM =
  "You are Filey, a personal finance/ERP agent inside the user's business app. You can ACT via tools, not just chat. Available actions: read data (stats, customers, products, invoices); create customers; create products and adjust stock; log expenses; create draft invoices; mark invoices sent/paid; make invoices recurring; open any app page; and when the user attaches a file, run PDF/image operations on it with run_file_tool (compress, convert, pdf↔images, extract text, rotate… — the result downloads to their device). Call tools whenever the user asks you to do something, confirm what you did in one short line, and never invent data — look it up. For destructive or ambiguous requests, ask first. Be concise and practical.";

const ORB_PRESETS = ["#FFD600", "#FF7A00", "#EC4899", "#7C3AED", "#2CADF6", "#3FB984", "#E5484D"];

function shade(hex: string, amt: number): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return "#" + (((f(r) << 16) | (f(g) << 8) | f(b)) >>> 0).toString(16).padStart(6, "0");
}
function orbTones(color: string) {
  return { base: "#1b1d22", accent1: color, accent2: shade(color, 0.28), accent3: shade(color, -0.28) };
}

type View = "chat" | "history";

export default function Copilot() {
  const { profile } = useAuth();
  const { toast, confirm, prompt } = useUI();
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => getActiveId() ?? loadChats()[0]?.id ?? null
  );
  const [view, setView] = useState<View>("chat");
  const [menuFor, setMenuFor] = useState<string | null>(null);
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
  const tones = orbTones(persona.orbColor);
  const persist = (next: Chat[]) => {
    setChats(next);
    saveChats(next);
  };
  const select = (id: string | null) => {
    setActiveIdState(id);
    setActiveId(id);
  };

  const active = chats.find((c) => c.id === activeId) ?? null;
  const turns = active?.turns ?? [];
  const needsOnboarding = ready && !persona.onboarded;

  const [draft, setDraft] = useState({
    userName: persona.userName || profile?.name?.split(" ")[0] || "",
    role: persona.role || "",
    vibe: persona.vibe as AiVibe,
  });

  useEffect(() => {
    if (open && ready && persona.onboarded && view === "chat")
      setTimeout(() => taRef.current?.focus(), 60);
  }, [open, ready, persona.onboarded, view]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    if (open && ready && persona.onboarded && !ctx)
      buildAiContext(profile?.company).then(setCtx).catch(() => {});
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
        text: `Hi${p.userName ? ` ${p.userName}` : ""}! I'm ${p.assistantName || "Filey"}. I can see your customers, invoices, products and more — ask me to draft an invoice line, a customer email, a summary, or anything about your business.`,
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
      setErr("You're offline — Filey AI needs a connection to reach your model.");
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
    const userTurn: ChatTurn = { role: "user", text: file ? `📎 ${file.name}\n${text}` : text };
    const afterUser = base.map((c) =>
      c.id === id
        ? {
            ...c,
            turns: [...c.turns, userTurn],
            updatedAt: Date.now(),
            title: c.title === "New chat" || !c.title ? deriveTitle([...c.turns, userTurn]) : c.title,
          }
        : c
    );
    persist(afterUser);
    setInput("");
    setBusy(true);
    setAttachment(file); // available to run_file_tool
    const attached = file;
    const convo = afterUser.find((c) => c.id === id)?.turns ?? [];
    try {
      const messages: AiMessage[] = [
        { role: "system", text: buildSystemPrompt(SYSTEM, getPersona(), ctx) },
        ...convo.slice(-TURN_CAP).map((t) => ({ role: t.role, text: t.text })),
      ];
      if (attached && attached.type.startsWith("image/")) {
        try {
          messages[messages.length - 1].images = [await fileToImage(attached)];
        } catch {
          /* vision optional */
        }
      }
      const reply = await aiAgent(messages, { maxTokens: 900 });
      setChats((prev) => {
        const next = prev.map((c) =>
          c.id === id
            ? { ...c, turns: [...c.turns, { role: "assistant" as const, text: reply || "(no response)" }], updatedAt: Date.now() }
            : c
        );
        saveChats(next);
        return next;
      });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setFile(null);
      setAttachment(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, busy, chats, activeId, ctx, file]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape") setOpen(false);
  };

  const renameChat = async (c: Chat) => {
    setMenuFor(null);
    const name = await prompt({ title: "Rename chat", defaultValue: c.title, confirmLabel: "Save" });
    if (name != null) persist(chats.map((x) => (x.id === c.id ? { ...x, title: name.trim() || x.title } : x)));
  };
  const shareChat = async (c: Chat) => {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(transcript(c));
      toast.success("Conversation copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  };
  const deleteChat = async (c: Chat) => {
    setMenuFor(null);
    const ok = await confirm({ title: "Delete this chat?", danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    const next = chats.filter((x) => x.id !== c.id);
    persist(next);
    if (activeId === c.id) select(next[0]?.id ?? null);
  };

  const bubble = (role: ChatTurn["role"]) =>
    role === "user"
      ? "ml-auto bg-primary-400 text-[#0A0A0A]"
      : "mr-auto bg-brand-50 text-ink dark:bg-white/5";

  return (
    <div className="no-print fixed bottom-5 right-5 z-[60] flex flex-col items-end">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="mb-3 flex h-[min(70vh,520px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#1E2025]"
          >
            {/* header */}
            <div className="flex items-center gap-2 border-b border-brand-100 px-3 py-3 dark:border-[#2A2C33]">
              <button
                onClick={() => setCustomizing((c) => !c)}
                aria-label="Customize assistant"
                title="Click to rename & recolour"
                className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <ColorOrb dimension="22px" tones={tones} />
              </button>
              <span className="truncate font-display text-sm font-bold text-ink">
                {view === "history" ? "Chats" : persona.assistantName || "Filey"}
              </span>
              {ready && persona.onboarded && (
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    onClick={startNewChat}
                    aria-label="New chat"
                    title="New chat"
                    className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setView((v) => (v === "history" ? "chat" : "history"));
                      setMenuFor(null);
                    }}
                    aria-label="History"
                    title="Chat history"
                    className={cn(
                      "rounded-lg p-1.5 cursor-pointer hover:bg-brand-50 dark:hover:bg-white/5",
                      view === "history" ? "text-ink dark:text-[#F4F5F6]" : "text-brand-400 hover:text-ink dark:hover:text-[#F4F5F6]"
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
                  "rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer",
                  !(ready && persona.onboarded) && "ml-auto"
                )}
              >
                <X size={16} />
              </button>
            </div>

            {/* customizer */}
            <AnimatePresence>
              {customizing && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-b border-brand-100 dark:border-[#2A2C33]"
                >
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
                                "ring-2 ring-ink ring-offset-1 dark:ring-offset-[#1E2025]"
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
                          className="h-6 w-8 cursor-pointer rounded border border-brand-200 bg-transparent dark:border-[#3A3D45]"
                        />
                      </div>
                    </div>
                    <button onClick={() => setCustomizing(false)} className="btn-ghost h-8 w-full">
                      Done
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* body */}
            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {!ready ? (
                <div className="space-y-3 text-sm text-brand-500">
                  <p>
                    Connect your own AI model to begin. Filey never sees your key — it
                    stays in this browser and talks to your provider directly.
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
                    Hi! I'm Filey. A couple of quick things so I can help you better —
                    I'll remember these.
                  </p>
                  <div className="field">
                    <label className="label">What should I call you?</label>
                    <input
                      className="input"
                      value={draft.userName}
                      onChange={(e) => setDraft((d) => ({ ...d, userName: e.target.value }))}
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
                    <select
                      className="select"
                      value={draft.vibe}
                      onChange={(e) => setDraft((d) => ({ ...d, vibe: e.target.value as AiVibe }))}
                    >
                      {AI_VIBES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
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
                            c.id === activeId && "bg-brand-50 dark:bg-white/5"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">
                              {c.title}
                            </span>
                            <span className="block text-[11px] text-brand-400">
                              {fmtDate(new Date(c.updatedAt).toISOString())} · {c.turns.length} msgs
                            </span>
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Chat options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor((m) => (m === c.id ? null : c.id));
                            }}
                            className="rounded-lg p-1 text-brand-400 hover:bg-brand-100 hover:text-ink dark:hover:bg-white/10 dark:hover:text-[#F4F5F6] cursor-pointer"
                          >
                            <MoreHorizontal size={16} />
                          </span>
                        </button>
                        {menuFor === c.id && (
                          <div className="absolute right-2 top-11 z-20 w-36 overflow-hidden rounded-xl border border-brand-200 bg-white py-1 shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#24262C]">
                            <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => renameChat(c)} />
                            <MenuItem icon={<Share2 size={14} />} label="Share" onClick={() => shareChat(c)} />
                            <MenuItem icon={<Trash2 size={14} />} label="Delete" danger onClick={() => deleteChat(c)} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : turns.length === 0 ? (
                <p className="text-sm text-brand-400">
                  Ask me to draft an invoice line, a customer email, a product
                  description, or anything about your business.
                </p>
              ) : (
                turns.map((t, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      bubble(t.role)
                    )}
                  >
                    {t.text}
                  </div>
                ))
              )}
              {busy && view === "chat" && (
                <div className="mr-auto w-fit rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-400 dark:bg-white/5">
                  Thinking…
                </div>
              )}
              {err && view === "chat" && (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>
              )}
            </div>

            {/* input */}
            {ready && persona.onboarded && view === "chat" && (
              <div className="border-t border-brand-100 p-2.5 dark:border-[#2A2C33]">
                {!online && (
                  <p className="mb-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning">
                    You're offline — Filey AI will reconnect automatically.
                  </p>
                )}
                {file && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs dark:bg-white/5">
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
                    className="grid h-10 w-9 shrink-0 place-items-center rounded-lg text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer"
                  >
                    <Paperclip size={17} />
                  </button>
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKey}
                    rows={1}
                    placeholder={online ? "Ask Filey AI…  (⌘/Ctrl+Enter)" : "Offline…"}
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
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Filey AI assistant"
        className="flex h-12 cursor-pointer items-center gap-2 rounded-full border border-brand-200 bg-white pl-2 pr-4 shadow-bento-hover dark:border-[#3A3D45] dark:bg-[#1E2025]"
      >
        <ColorOrb dimension="32px" tones={tones} />
        <span className="font-display text-sm font-bold text-ink">Ask AI</span>
      </motion.button>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors cursor-pointer",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink dark:text-[#F4F5F6] hover:bg-brand-50 dark:hover:bg-white/5"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
