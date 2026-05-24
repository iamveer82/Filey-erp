import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Send, X, Trash2 } from "lucide-react";
import { cn } from "../lib/format";
import {
  aiChat,
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
import { buildAiContext } from "../lib/aiContext";
import { useAuth } from "../lib/auth";
import ColorOrb from "./ColorOrb";

/* Floating bottom-right AI copilot (BYOK, see lib/ai). On first run it asks a
 * couple of questions (name, role, vibe) and remembers them permanently. It
 * reads the user's own business data for grounding, keeps a rolling ~30-turn
 * memory, and is barred from passwords/settings by the system guardrails. */

const SYSTEM =
  "You are Filey, the assistant inside the Filey ERP/CRM web app. Help the user run their business: draft invoice line items, customer emails, product descriptions, summaries, and answer questions. Be concise and practical — prefer short, ready-to-use output over long explanations.";

const MEM_KEY = "filey.ai.history";
const MEM_CAP = 30;

interface Turn {
  role: "user" | "assistant";
  text: string;
}

function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    return raw ? (JSON.parse(raw) as Turn[]).slice(-MEM_CAP) : [];
  } catch {
    return [];
  }
}
function saveTurns(turns: Turn[]) {
  try {
    localStorage.setItem(MEM_KEY, JSON.stringify(turns.slice(-MEM_CAP)));
  } catch {
    /* ignore quota */
  }
}

const ORB_PRESETS = ["#FFD600", "#FF7A00", "#EC4899", "#7C3AED", "#2CADF6", "#3FB984", "#E5484D"];

/** Lighten (amt>0) or darken (amt<0) a hex colour. */
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

export default function Copilot() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [persona, setPersonaState] = useState<AiPersona>(getPersona);
  const [ctx, setCtx] = useState<string>("");
  const [customizing, setCustomizing] = useState(false);
  const ready = aiReady();
  const navigate = useNavigate();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const save = (patch: Partial<AiPersona>) => setPersonaState(setPersona(patch));
  const tones = orbTones(persona.orbColor);

  // onboarding form draft
  const [draft, setDraft] = useState({
    userName: persona.userName || profile?.name?.split(" ")[0] || "",
    role: persona.role || "",
    vibe: persona.vibe as AiVibe,
  });

  const needsOnboarding = ready && !persona.onboarded;

  useEffect(() => {
    if (open && ready && persona.onboarded) setTimeout(() => taRef.current?.focus(), 60);
  }, [open, ready, persona.onboarded]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    saveTurns(turns);
  }, [turns]);
  // pull a fresh snapshot of the user's data whenever the panel opens
  useEffect(() => {
    if (open && ready && persona.onboarded && !ctx) {
      buildAiContext(profile?.company).then(setCtx).catch(() => {});
    }
  }, [open, ready, persona.onboarded, ctx, profile?.company]);

  const finishOnboarding = () => {
    const p = setPersona({
      userName: draft.userName.trim(),
      role: draft.role.trim(),
      vibe: draft.vibe,
      onboarded: true,
    });
    setPersonaState(p);
    setTurns((t) => [
      ...t,
      {
        role: "assistant",
        text: `Hi${p.userName ? ` ${p.userName}` : ""}! I'm ${p.assistantName || "Filey"}. I can see your customers, invoices, products and more — ask me to draft an invoice line, a customer email, a summary, or anything about your business.`,
      },
    ]);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const messages: AiMessage[] = [
        { role: "system", text: buildSystemPrompt(SYSTEM, getPersona(), ctx) },
        ...next.slice(-MEM_CAP).map((t) => ({ role: t.role, text: t.text })),
      ];
      const reply = await aiChat(messages, { maxTokens: 900 });
      setTurns((t) => [...t, { role: "assistant", text: reply || "(no response)" }]);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input, busy, turns, ctx]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape") setOpen(false);
  };

  const bubble = (role: Turn["role"]) =>
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
            <div className="flex items-center gap-2 border-b border-brand-100 px-4 py-3 dark:border-[#2A2C33]">
              <button
                onClick={() => setCustomizing((c) => !c)}
                aria-label="Customize assistant"
                title="Click to rename & recolour"
                className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <ColorOrb dimension="22px" tones={tones} />
              </button>
              <span className="font-display text-sm font-bold text-ink">
                {persona.assistantName || "Filey"}
              </span>
              {turns.length > 0 && (
                <button
                  onClick={() => {
                    setTurns([]);
                    setErr(null);
                  }}
                  aria-label="Clear conversation"
                  title="Clear conversation"
                  className="ml-auto rounded-lg p-1 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className={cn(
                  "rounded-lg p-1 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer",
                  turns.length === 0 && "ml-auto"
                )}
              >
                <X size={16} />
              </button>
            </div>

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
              {busy && (
                <div className="mr-auto w-fit rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-400 dark:bg-white/5">
                  Thinking…
                </div>
              )}
              {err && (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>
              )}
            </div>

            {ready && persona.onboarded && (
              <div className="border-t border-brand-100 p-2.5 dark:border-[#2A2C33]">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKey}
                    rows={1}
                    placeholder="Ask Filey AI…  (⌘/Ctrl+Enter)"
                    className="textarea max-h-32 min-h-[40px] flex-1 py-2"
                  />
                  <button
                    onClick={() => void send()}
                    disabled={busy || !input.trim()}
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
