import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Loader2 } from "lucide-react";
import { aiChat, aiReady, getPersona, buildSystemPrompt } from "../lib/ai";
import { buildAiContext } from "../lib/aiContext";
import { useAuth } from "../lib/auth";
import ColorOrb from "./ColorOrb";

/* Dashboard "AI daily briefing" — one BYOK call grounded in the user's data.
 * Cached per-day in this browser so it doesn't re-bill on every visit. */

const CACHE_KEY = "filey.ai.summary";
const today = () => new Date().toISOString().slice(0, 10);

function cached(): string {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.date === today()) return c.text as string;
  } catch {
    /* ignore */
  }
  return "";
}

export default function AiSummaryCard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const ready = aiReady();
  const [text, setText] = useState(cached);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ctx = await buildAiContext(profile?.company);
      const sys = buildSystemPrompt(
        "You are the Filey assistant writing a short daily briefing for the owner.",
        getPersona(),
        ctx
      );
      const out = await aiChat(
        [
          { role: "system", text: sys },
          {
            role: "user",
            text: "In 3-4 short bullet points, summarise the current state of my business and the single most important action to take today. Be specific using the data. No preamble, no closing line.",
          },
        ],
        { maxTokens: 350, temperature: 0.4 }
      );
      setText(out);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today(), text: out }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="card mb-4 flex items-center gap-3">
        <ColorOrb dimension="28px" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">AI daily briefing</p>
          <p className="text-xs text-brand-500">
            Connect your AI model to get a data-grounded summary of your business.
          </p>
        </div>
        <button className="btn-ghost h-9 shrink-0" onClick={() => navigate("/settings?section=ai")}>
          Connect
        </button>
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <div className="mb-2 flex items-center gap-2">
        <ColorOrb dimension="22px" />
        <p className="flex-1 text-sm font-bold text-ink">AI daily briefing</p>
        <button className="btn-ghost h-8" onClick={generate} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {text ? "Refresh" : "Generate"}
        </button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-brand-600">{text}</div>
      ) : (
        !busy && (
          <p className="text-xs text-brand-400">
            Click Generate for a quick, data-grounded summary of today.
          </p>
        )
      )}
    </div>
  );
}
