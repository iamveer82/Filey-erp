import { useState } from "react";
import { Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import {
  getAiConfig,
  setAiConfig,
  aiChat,
  type AiConfig,
  type AiProvider,
} from "../lib/ai";
import { useUI } from "../lib/ui";

/* Settings → AI Assistant. Bring-your-own-key: the key lives only in this
 * browser (localStorage) and requests go straight to the chosen provider. */

interface Preset {
  label: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

const PRESETS: Preset[] = [
  { label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Anthropic (Claude)", provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6" },
  { label: "OpenRouter (any model)", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { label: "Groq", provider: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (local)", provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
];

export default function AiSettings() {
  const { toast } = useUI();
  const [cfg, setCfg] = useState<AiConfig>(getAiConfig());
  const [testing, setTesting] = useState(false);

  const update = (patch: Partial<AiConfig>) => {
    const next = setAiConfig(patch);
    setCfg(next);
  };

  const applyPreset = (p: Preset) =>
    update({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });

  const test = async () => {
    setTesting(true);
    try {
      const r = await aiChat([{ role: "user", text: "Reply with the single word: ok" }], {
        maxTokens: 8,
        temperature: 0,
      });
      toast.success(`Connected — model replied: "${r.slice(0, 40)}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card max-w-2xl space-y-5">
      <header className="flex items-start gap-3">
        <span className="rounded-xl bg-primary-100 text-primary-700 p-2.5 dark:bg-primary-400/15 dark:text-primary-300">
          <Sparkles size={18} />
        </span>
        <div>
          <p className="font-bold text-ink">AI Assistant</p>
          <p className="text-sm text-brand-500">
            Connect any AI model with your own key. Powers the Ask-AI copilot and
            document scanning.
          </p>
        </div>
      </header>

      <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-xs font-medium text-success">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <span>
          Your key is stored only in this browser and is sent straight to your
          provider — it never reaches Filey's servers.
        </span>
      </div>

      {/* quick presets */}
      <div>
        <p className="label">Quick setup</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="chip"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label className="label">Provider API</label>
          <select
            className="select"
            value={cfg.provider}
            onChange={(e) => update({ provider: e.target.value as AiProvider })}
          >
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Model</label>
          <input
            className="input"
            value={cfg.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="gpt-4o-mini"
          />
        </div>
      </div>

      <div className="field">
        <label className="label">API base URL</label>
        <input
          className="input"
          value={cfg.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
        <p className="help">
          {cfg.provider === "anthropic"
            ? "Anthropic uses its native endpoint; this is only used if you proxy it."
            : "Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, Together, local Ollama…)."}
        </p>
      </div>

      <div className="field">
        <label className="label">API key</label>
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={cfg.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          placeholder="sk-…"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={test}
          disabled={testing || !cfg.apiKey.trim()}
          className="btn-primary"
        >
          {testing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Test connection
        </button>
        {cfg.apiKey && (
          <button
            type="button"
            onClick={() => update({ apiKey: "" })}
            className="btn-ghost"
          >
            Clear key
          </button>
        )}
      </div>
    </div>
  );
}
