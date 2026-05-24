import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Send, X, Trash2 } from "lucide-react";
import { cn } from "../lib/format";
import { aiChat, aiReady, AiError, type AiMessage } from "../lib/ai";
import ColorOrb from "./ColorOrb";

/* Floating bottom-right AI copilot. Talks to the user's own model (BYOK, see
 * lib/ai). Drafts invoice lines / emails / descriptions and answers questions.
 * Keeps a short rolling memory (last ~30 turns) persisted in this browser. */

const SYSTEM =
  "You are Filey, the assistant inside the Filey ERP/CRM web app. Help the user run their business: draft invoice line items, customer emails, product descriptions, summaries, and answer questions. Be concise and practical — prefer short, ready-to-use output over long explanations.";

const MEM_KEY = "filey.ai.history";
const MEM_CAP = 30; // rolling memory window

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

export default function Copilot() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = aiReady();
  const navigate = useNavigate();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => taRef.current?.focus(), 60);
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    saveTurns(turns);
  }, [turns]);

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
        { role: "system", text: SYSTEM },
        ...next.slice(-MEM_CAP).map((t) => ({ role: t.role, text: t.text })),
      ];
      const reply = await aiChat(messages, { maxTokens: 900 });
      setTurns((t) => [...t, { role: "assistant", text: reply || "(no response)" }]);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input, busy, turns]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape") setOpen(false);
  };

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
              <ColorOrb dimension="22px" />
              <span className="font-display text-sm font-bold text-ink">Filey AI</span>
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
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      t.role === "user"
                        ? "ml-auto bg-primary-400 text-[#0A0A0A]"
                        : "mr-auto bg-brand-50 text-ink dark:bg-white/5"
                    )}
                  >
                    {t.text}
                  </div>
                ))
              )}
              {busy && (
                <div className="mr-auto rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-400 dark:bg-white/5">
                  Thinking…
                </div>
              )}
              {err && (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>
              )}
            </div>

            {ready && (
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
        <ColorOrb dimension="32px" />
        <span className="font-display text-sm font-bold text-ink">Ask AI</span>
      </motion.button>
    </div>
  );
}
