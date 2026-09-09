import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, RefreshCw, ChevronDown } from "lucide-react";
import {
  getAiConfig,
  setAiConfig,
  aiChat,
  aiReady,
  listLocalAiModels,
  type AiConfig,
  type AiProvider,
} from "../lib/ai";
import { isLocalAiEndpoint, mergeAiConfig } from "../lib/aiEndpoint";
import { useUI } from "../lib/ui";
import { SelectMenu } from "./ui-menu";
import { SettingsPanel, SettingsSection } from "./SettingsLayout";

/* Settings → AI Assistant. Bring-your-own-key: the key lives only in this
 * browser (localStorage) and requests go straight to the chosen provider. */

interface Preset {
  label: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  access?: "local" | "free-tier";
  guide?: string;
  keyUrl?: string;
  note?: string;
}

const PRESETS: Preset[] = [
  {
    label: "Anthropic (Claude)",
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
    label: "OpenRouter · free models",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    access: "free-tier",
    guide: "https://openrouter.ai/docs/guides/routing/routers/free-router",
    keyUrl: "https://openrouter.ai/settings/keys",
    note: "Use your own OpenRouter key. The free router selects an available model; capacity, model availability and provider limits can change.",
  },
  {
    label: "Groq",
    provider: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    access: "free-tier",
    guide: "https://console.groq.com/docs/rate-limits",
    keyUrl: "https://console.groq.com/keys",
    note: "Use your own Groq key. Free-plan requests are limited by model and account; check your provider dashboard for the current allowance.",
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
    model: "",
    access: "local",
    guide: "https://docs.ollama.com/api/openai-compatibility",
    note: "Start Ollama and download a model that fits your device. Find local models below, then choose a tool-capable model. Downloaded local models need no API key; cloud-backed models still use their provider account.",
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
    model: "gemini-2.5-flash",
    access: "free-tier",
    guide: "https://ai.google.dev/gemini-api/docs/pricing",
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Use your own Google AI Studio key. Free-tier availability and quotas depend on your account and region. Google may use free-tier content to improve its products; check its data terms before sending business information.",
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
    model: "kimi-k2.7-code",
  },
  {
    label: "OpenCode Zen · Claude",
    provider: "anthropic",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "claude-sonnet-5",
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
    model: "",
    access: "local",
    guide: "https://lmstudio.ai/docs/developer/openai-compat",
    note: "Download a model in LM Studio and start its local server. Find local models below and enter its model ID. Add an API token here only if you enabled server authentication.",
  },
];

/** Canonical base URL per provider, used to auto-fill when the provider
 *  dropdown changes (OpenAI-compatible providers can then be narrowed with a
 *  preset or edited by hand). */
const PROVIDER_DEFAULT_URL: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

export default function AiSettings() {
  const { toast } = useUI();
  const [cfg, setCfg] = useState<AiConfig>(getAiConfig());
  const [testing, setTesting] = useState(false);
  const [finding, setFinding] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelMessage, setModelMessage] = useState("");
  const [keyNotice, setKeyNotice] = useState("");
  const request = useRef(0);
  const local = isLocalAiEndpoint(cfg);
  const preset = PRESETS.find((p) => p.baseUrl === cfg.baseUrl.trim().replace(/\/+$/, "") &&
    (p.model === cfg.model || p.access === "local")) ??
    PRESETS.find((p) => p.baseUrl === cfg.baseUrl.trim().replace(/\/+$/, ""));
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
      request.current++;
      flush();
    },
    []
  );

  const update = (patch: Partial<AiConfig>, immediate = false) => {
    const next = mergeAiConfig(cfg, patch);
    if (cfg.apiKey && !next.apiKey && patch.apiKey === undefined)
      setKeyNotice("The endpoint changed. Enter this provider's own key if it requires one.");
    else if (patch.apiKey !== undefined) setKeyNotice("");
    if (patch.baseUrl !== undefined || patch.provider !== undefined || patch.apiKey !== undefined) {
      request.current++;
      setFinding(false);
      setModels([]);
      setModelMessage("");
    }
    pending.current = next;
    setCfg(next);
    clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, 400);
  };

  const applyPreset = (p: Preset) =>
    update({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });

  const findModels = async () => {
    const current = ++request.current;
    setFinding(true);
    setModelMessage("");
    try {
      const found = await listLocalAiModels(cfg);
      if (request.current !== current) return;
      setModels(found);
      setModelMessage(found.length ? "Choose a model below or enter its ID. Tool and image support depend on the model." :
        "No models found. Download a model in your local server, then try again.");
    } catch (error) {
      if (request.current === current) setModelMessage(
        `${error instanceof Error ? error.message : String(error)} Check that your local server is running. Browser builds also need the server to allow this origin.`);
    } finally {
      if (request.current === current) setFinding(false);
    }
  };

  const test = async () => {
    flush(); // test what's on screen, not the last debounced snapshot
    setTesting(true);
    try {
      const r = await aiChat([{ role: "user", text: "Reply with the single word: ok" }], {
        maxTokens: 8,
        temperature: 0,
      });
      if (!r.trim()) throw new Error("The model returned no text. Check the model ID and compatibility, then try again.");
      toast.success(`Connected - model replied: "${r.slice(0, 40)}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsPanel>
      <SettingsSection title="AI provider" description="Run Filey AI on your device or connect a provider with your own key.">
        <div className="space-y-2">
          <label className="label" htmlFor="ai-preset">Provider preset</label>
          <select id="ai-preset" className="input" value={preset?.label ?? ""} onChange={(event) => {
            const selected = PRESETS.find((p) => p.label === event.target.value);
            if (selected) applyPreset(selected);
          }}>
            <option value="" disabled>Custom configuration</option>
            <optgroup label="Local · no API key required">
              {PRESETS.filter((p) => p.access === "local").map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="Hosted · free tiers">
              {PRESETS.filter((p) => p.access === "free-tier").map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="More providers · bring your own key">
              {PRESETS.filter((p) => !p.access).map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
          </select>
          <p className="text-xs leading-relaxed text-muted-foreground">Downloaded local models use your hardware. Hosted free tiers need your own account and have limits.</p>
        </div>
        {preset?.note && <p className="text-[13px] leading-relaxed text-muted-foreground">{preset.note}</p>}
        {(preset?.guide || preset?.keyUrl) && <div className="flex flex-wrap items-center gap-3">
          {preset.keyUrl && <a className="btn-ghost" href={preset.keyUrl} target="_blank" rel="noopener noreferrer">Get your API key</a>}
          {preset.guide && <a className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href={preset.guide} target="_blank" rel="noopener noreferrer">Provider setup & limits</a>}
        </div>}
      </SettingsSection>

      <SettingsSection title="Connection" description="Choose a model for chat and document scanning. Business actions need tool calling; document images need vision support."
        actions={<>
          <p className="mr-auto max-w-sm text-xs leading-relaxed text-muted-foreground">Test sends only a short greeting and uses your provider's allowance. It does not read or change business records.</p>
          <button type="button" onClick={test} disabled={testing || !aiReady(cfg)} className="btn-primary">
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Test connection
          </button>
        </>}>
        <div className="space-y-2">
          <label className="label" htmlFor="ai-model">Model</label>
          <div className="flex flex-wrap gap-2">
            <input id="ai-model" className="input min-w-0 flex-1 basis-48" value={cfg.model} onChange={(e) => update({ model: e.target.value })}
              placeholder={local ? "Enter an installed model ID" : "Enter the provider's model ID"} />
            {local && <button type="button" className="btn-ghost" disabled={finding} onClick={() => void findModels()}>
              <RefreshCw size={15} className={finding ? "animate-spin" : ""} />
              {finding ? "Finding models…" : "Find local models"}
            </button>}
          </div>
          {local && modelMessage && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{modelMessage}</p>}
          {local && models.length > 0 && <SelectMenu ariaLabel="Available local models" value={models.includes(cfg.model) ? cfg.model : ""}
            onChange={(model) => update({ model })} options={[{ value: "", label: "Choose a local model" }, ...models.map((model) => ({ value: model, label: model }))]} />}
        </div>

        <div className="space-y-2">
          <label className="label" htmlFor="ai-api-key">API key{local ? " (optional)" : ""}</label>
          <div className="flex gap-2">
            <input id="ai-api-key" className="input min-w-0 flex-1" type="password" autoComplete="off" value={cfg.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })} placeholder={local ? "Only if your local server requires a token" : "Your provider's API key"} />
            {cfg.apiKey && <button type="button" onClick={() => update({ apiKey: "" }, true)} className="btn-ghost shrink-0">Clear key</button>}
          </div>
          {local && <p className="text-xs leading-relaxed text-muted-foreground">Leave blank for local Ollama or LM Studio with authentication disabled.</p>}
          {keyNotice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{keyNotice}</p>}
        </div>

        <details className="group border-t border-border pt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">Advanced connection details{!preset && <span className="mt-1 block break-all text-xs font-normal text-muted-foreground">{cfg.baseUrl || "No endpoint set"}</span>}</span>
            <ChevronDown size={15} className="shrink-0 group-open:rotate-180" />
          </summary>
          <div className="space-y-4 pt-3">
            <div className="space-y-2">
              <label className="label">Provider API</label>
              <SelectMenu ariaLabel="Provider API" value={cfg.provider} onChange={(v) => {
                const provider = v as AiProvider;
                update({ provider, baseUrl: PROVIDER_DEFAULT_URL[provider] });
              }} options={[{ value: "openai", label: "OpenAI-compatible" }, { value: "anthropic", label: "Anthropic (Claude)" }]} />
            </div>
            <div className="space-y-2">
              <label className="label" htmlFor="ai-base-url">API base URL</label>
              <input id="ai-base-url" className="input" value={cfg.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {cfg.provider === "anthropic"
                  ? "Anthropic-compatible Messages endpoint. Custom gateway URLs are supported."
                  : "Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, Together, local Ollama…)."}
              </p>
            </div>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection title="Privacy & storage" description="Connection changes save automatically in this browser or desktop profile.">
        <p className="text-[13px] leading-relaxed text-muted-foreground">AI keys are stored in this browser or desktop profile, without application-level encryption. Requests go to your selected provider.</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">Local model inference can stay on your device; enabled web and integration tools still make their own network requests.</p>
      </SettingsSection>
    </SettingsPanel>
  );
}
