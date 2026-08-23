import { useEffect, useRef, useState } from "react";
import { Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import {
  getAiConfig,
  setAiConfig,
  aiChat,
  type AiConfig,
  type AiProvider,
} from "../lib/ai";
import { useUI } from "../lib/ui";
import { SelectMenu } from "./ui-menu";

/* Settings → AI Assistant. Bring-your-own-key: the key lives only in this
 * browser (localStorage) and requests go straight to the chosen provider. */

interface Preset {
  label: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

const PRESETS: Preset[] = [
  {
    label: "Anthropic (Claude) - recommended",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5",
  },
  {
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    label: "OpenRouter (any model)",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    label: "Groq",
    provider: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  {
    label: "Moonshot (Kimi)",
    provider: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  {
    label: "DeepSeek",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    label: "Ollama (local)",
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
  },
  {
    label: "Ollama Cloud",
    provider: "openai",
    baseUrl: "https://ollama.com/v1",
    model: "gpt-oss:120b",
  },
  {
    label: "xAI (Grok)",
    provider: "openai",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-2-latest",
  },
  {
    label: "Google Gemini",
    provider: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  {
    label: "Mistral",
    provider: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
  },
  {
    label: "Together AI",
    provider: "openai",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    label: "OpenCode Zen",
    provider: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "grok-code",
  },
  {
    label: "Cerebras",
    provider: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
  },
  {
    label: "Perplexity",
    provider: "openai",
    baseUrl: "https://api.perplexity.ai",
    model: "sonar",
  },
  {
    label: "DeepInfra",
    provider: "openai",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    model: "meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    label: "Vercel AI Gateway",
    provider: "openai",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    label: "GLM (Zhipu)",
    provider: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.6",
  },
  {
    label: "LM Studio (local)",
    provider: "openai",
    baseUrl: "http://localhost:1234/v1",
    model: "insert-loaded-model-id",
  },
];

/** Canonical base URL per provider, used to auto-fill when the provider
 *  dropdown changes (OpenAI-compatible providers can then be narrowed with a
 *  preset chip or edited by hand). */
const PROVIDER_DEFAULT_URL: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

export default function AiSettings() {
  const { toast } = useUI();
  const [cfg, setCfg] = useState<AiConfig>(getAiConfig());
  const [testing, setTesting] = useState(false);
  // Typing used to write localStorage on every keystroke — with storage
  // blocked, each keypress threw. Local state updates immediately; the store
  // is written debounced, and flushed before anything reads it back.
  const pending = useRef<Partial<AiConfig>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = () => {
    if (!Object.keys(pending.current).length) return;
    const patch = pending.current;
    pending.current = {};
    setAiConfig(patch);
  };

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush();
    },
    []
  );

  const update = (patch: Partial<AiConfig>, immediate = false) => {
    pending.current = { ...pending.current, ...patch };
    setCfg((c) => ({ ...c, ...patch }));
    clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, 400);
  };

  const applyPreset = (p: Preset) =>
    update({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });

  const test = async () => {
    flush(); // test what's on screen, not the last debounced snapshot
    setTesting(true);
    try {
      const r = await aiChat([{ role: "user", text: "Reply with the single word: ok" }], {
        maxTokens: 8,
        temperature: 0,
      });
      toast.success(`Connected - model replied: "${r.slice(0, 40)}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card max-w-2xl space-y-5">
      <header className="flex items-start gap-3">
        <span className="rounded-full bg-primary-100 text-primary-700 p-2.5 dark:bg-primary-400/15 dark:text-primary-300">
          <Sparkles size={18} />
        </span>
        <div>
          <p className="font-medium text-ink">AI Assistant</p>
          <p className="text-sm text-brand-500">
            Bring your own AI model to power smart features across Filey.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-brand-200 bg-brand-50 p-3.5 text-xs text-brand-700 leading-relaxed">
        <p className="font-medium mb-1">What this powers:</p>
        <ul className="space-y-0.5 list-disc pl-4">
          <li>
            <strong>Ask AI</strong> - chat about your business data (inventory, orders,
            invoices)
          </li>
          <li>
            <strong>Document scanning</strong> - extract data from receipts, invoices, and
            scanned PDFs
          </li>
          <li>
            <strong>AI Briefing</strong> - daily summary on your dashboard
          </li>
        </ul>
        <p className="mt-2 text-brand-500">
          Just pick a preset, paste your API key, and test the connection.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-2.5 text-xs font-medium text-success">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <span>
          Your key is stored only in this browser and is sent straight to your provider —
          it never reaches Filey's servers.
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
          <SelectMenu
            ariaLabel="Provider API"
            value={cfg.provider}
            onChange={(v) => {
              const provider = v as AiProvider;
              update({ provider, baseUrl: PROVIDER_DEFAULT_URL[provider] });
            }}
            options={[
              { value: "openai", label: "OpenAI-compatible" },
              { value: "anthropic", label: "Anthropic (Claude)" },
            ]}
          />
        </div>
        <div className="field">
          <label className="label">Model</label>
          <input
            className="input"
            value={cfg.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="claude-opus-5"
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
          {testing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} />
          )}
          Test connection
        </button>
        {cfg.apiKey && (
          <button
            type="button"
            onClick={() => update({ apiKey: "" }, true)}
            className="btn-ghost"
          >
            Clear key
          </button>
        )}
      </div>
    </div>
  );
}
