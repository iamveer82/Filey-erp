import { FileySpinner as Loader2 } from "./FileySpinner";
import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, ChevronDown, Check, Eye, EyeOff, KeyRound, ExternalLink, Save, CircleAlert } from "lucide-react";
import {
  getAiConfig,
  setAiConfig,
  aiChat,
  listAiModels,
  aiCredentialName,
  type AiConfig,
  type AiProvider,
} from "../lib/ai";
import { aiEndpoint, isLocalAiEndpoint, mergeAiConfig } from "../lib/aiEndpoint";
import { useUI } from "../lib/ui";
import { SettingsPanel, SettingsSection } from "./SettingsLayout";
import { getCacheScope } from "../lib/api";
import { CREDENTIAL_EVENT, flushCredentials, hasCredential, quarantineLegacyCredentials } from "../lib/credentialStore";

/* Settings → AI Assistant. Provider metadata is separate from credentials. */

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
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    label: "OpenRouter (any model)",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyUrl: "https://openrouter.ai/settings/keys",
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
    model: "grok-4.6",
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
    model: "gpt-oss-120b",
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
  const [cfg, setCfg] = useState<AiConfig>(() => ({ ...getAiConfig(), apiKey: "" }));
  const [dirty, setDirty] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "models" | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelMessage, setModelMessage] = useState("");
  const [keyNotice, setKeyNotice] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedKey, setSavedKey] = useState(() => hasCredential(aiCredentialName(getAiConfig())));
  const scope = useRef(getCacheScope());
  const request = useRef<AbortController | null>(null);
  const local = isLocalAiEndpoint(cfg);
  const desktop = "__TAURI_INTERNALS__" in window;
  const credentialName = aiCredentialName(cfg);
  const preset = PRESETS.find(p => p.provider === cfg.provider && p.baseUrl === cfg.baseUrl.trim().replace(/\/+$/, "") &&
    (p.model === cfg.model || p.access === "local")) ??
    PRESETS.find(p => p.provider === cfg.provider && p.baseUrl === cfg.baseUrl.trim().replace(/\/+$/, ""));
  const keyAvailable = keyChanged ? !!cfg.apiKey.trim() : savedKey;
  const ready = !!aiEndpoint(cfg.baseUrl) && !!cfg.model.trim() && (local || keyAvailable);

  useEffect(() => {
    const refresh = () => setSavedKey(hasCredential(credentialName));
    window.addEventListener(CREDENTIAL_EVENT, refresh);
    return () => window.removeEventListener(CREDENTIAL_EVENT, refresh);
  }, [credentialName]);

  useEffect(() => {
    void quarantineLegacyCredentials().catch(() => toast.error("Legacy credentials could not be moved to secure storage. Unlock your OS account and try again."));
    const reset = () => {
      if (scope.current === getCacheScope()) return;
      request.current?.abort();
      request.current = null;
      scope.current = getCacheScope();
      const next = getAiConfig();
      setCfg({ ...next, apiKey: "" });
      setSavedKey(hasCredential(aiCredentialName(next)));
      setDirty(false); setKeyChanged(false); setShowKey(false); setBusy(null);
      setResult(null); setModels([]); setModelMessage(""); setKeyNotice("");
    };
    window.addEventListener("filey:agent-storage", reset);
    return () => { request.current?.abort(); request.current = null; window.removeEventListener("filey:agent-storage", reset); };
  }, [toast]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (patch: Partial<AiConfig>) => {
    const next = mergeAiConfig(cfg, patch);
    if (aiEndpoint(cfg.baseUrl)?.origin !== aiEndpoint(next.baseUrl)?.origin) {
      next.apiKey = "";
      setKeyChanged(false); setShowKey(false);
      setKeyNotice("Each provider uses its own key. Saved keys stay with their original provider.");
    }
    if (patch.apiKey !== undefined) { setKeyChanged(true); setKeyNotice(""); }
    if (patch.baseUrl !== undefined || patch.provider !== undefined || patch.apiKey !== undefined) {
      setModels([]); setModelMessage("");
    }
    setCfg(next); setDirty(true); setResult(null);
    setSavedKey(hasCredential(aiCredentialName(next)));
  };

  const persist = async () => {
    if (!scope.current || scope.current !== getCacheScope()) throw new Error("Sign in to this workspace before saving AI settings.");
    if (!aiEndpoint(cfg.baseUrl)) throw new Error("Enter a valid API base URL.");
    const { apiKey, ...settings } = cfg;
    setAiConfig({ ...settings, baseUrl: settings.baseUrl.trim().replace(/\/+$/, ""), model: settings.model.trim(),
      ...(keyChanged ? { apiKey: apiKey.trim() } : {}) }, scope.current);
    // An unrelated failed integration key must not block this AI provider.
    await flushCredentials(aiCredentialName(cfg));
    setDirty(false); setKeyChanged(false); setCfg(current => ({ ...current, apiKey: "" }));
    setShowKey(false); setSavedKey(hasCredential(aiCredentialName(cfg)));
  };

  const run = async (action: "save" | "test" | "models") => {
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), action === "test" ? 60000 : 15000);
    setBusy(action); setResult(null);
    try {
      if (action === "models") {
        // Discover from the draft without replacing the user's saved settings.
        const found = await listAiModels(cfg, controller.signal, !keyChanged);
        if (controller.signal.aborted) return;
        setModels(found);
        setModelMessage(found.length ? `${found.length} models available. Choose a chat model with tool support for business actions.` :
          local ? "No models installed. Download one in your local server, then refresh." : "No models returned. Enter a model ID from your provider.");
      } else {
        await persist();
        if (controller.signal.aborted) return;
        if (action === "save") setResult({ ok: true, text: "Settings saved. Test the connection to verify your model." });
        else {
          const text = await aiChat([{ role: "user", text: "Reply with the single word: ok" }], { maxTokens: 2048, signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!text.trim()) throw new Error("The provider accepted the request but returned no text. Try a different chat model; this model may need a larger reasoning budget.");
          setResult({ ok: true, text: `Connected to ${cfg.model.trim()}. Your model returned a text response.` });
          toast.success("AI connection verified");
        }
      }
    } catch (error) {
      if (request.current !== controller) return;
      const text = controller.signal.aborted ? "The connection check timed out. Check your network or try another model." :
        error instanceof Error ? error.message : typeof error === "string" ? error : "Could not connect. Check the provider, key and model.";
      if (action === "models") setModelMessage(`${text} You can enter the model ID manually.`);
      else setResult({ ok: false, text });
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(null); }
    }
  };

  return (
    <SettingsPanel>
      <SettingsSection title="AI provider" description="Choose where Filey AI runs. Connect your own provider or use a model on this device.">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5"><Sparkles size={13} />{local ? "On this device" : "Your provider"}</span>
          <span>{dirty ? "Unsaved changes" : "Settings for this workspace"}</span>
        </div>
        <div className="space-y-2">
          <label className="label" htmlFor="ai-preset">Provider preset</label>
          <select id="ai-preset" className="input" disabled={!!busy} value={preset?.label ?? ""} onChange={event => {
            const selected = PRESETS.find(p => p.label === event.target.value);
            if (selected) update({ provider: selected.provider, baseUrl: selected.baseUrl, model: selected.model });
          }}>
            <option value="" disabled>Custom configuration</option>
            <optgroup label="Local · no API key required">
              {PRESETS.filter(p => p.access === "local").map(p => <option key={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="Hosted · free tiers">
              {PRESETS.filter(p => p.access === "free-tier").map(p => <option key={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="More providers · bring your own key">
              {PRESETS.filter(p => !p.access).map(p => <option key={p.label}>{p.label}</option>)}
            </optgroup>
          </select>
        </div>
        {preset?.note && <p className="text-[13px] leading-relaxed text-muted-foreground">{preset.note}</p>}
        {(preset?.guide || preset?.keyUrl) && <div className="flex flex-wrap items-center gap-2">
          {preset.keyUrl && <a className="btn-ghost rounded-full" href={preset.keyUrl} target="_blank" rel="noopener noreferrer"><KeyRound size={14} />Get your API key<ExternalLink size={12} /></a>}
          {preset.guide && <a className="btn-ghost rounded-full" href={preset.guide} target="_blank" rel="noopener noreferrer">Setup guide<ExternalLink size={12} /></a>}
        </div>}
      </SettingsSection>

      <SettingsSection title="Connection" description="Add your key, choose a model and test the connection. Chat and agent actions use this model."
        actions={<>
          <p className="mr-auto max-w-sm text-xs leading-relaxed text-muted-foreground">Testing saves these settings and sends a short greeting. Provider usage limits apply.</p>
          <button type="button" onClick={() => void run("save")} disabled={!!busy || !dirty} className="btn-ghost rounded-full">
            {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save changes
          </button>
          <button type="button" onClick={() => void run("test")} disabled={!!busy || !ready} className="btn-primary rounded-full">
            {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy === "test" ? "Testing connection…" : "Test connection"}
          </button>
        </>}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="ai-api-key">API key{local ? " (optional)" : ""}</label>
            {savedKey && !keyChanged && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check size={13} />{desktop ? "Key saved securely" : "Key available until reload"}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-48">
              <input id="ai-api-key" className="input w-full pr-11" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false}
                disabled={!!busy} value={cfg.apiKey} onChange={event => update({ apiKey: event.target.value })}
                placeholder={savedKey && !keyChanged ? "Saved key · enter a new key to replace" : local ? "Only if server authentication is enabled" : "Paste your provider's API key"} />
              <button type="button" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                disabled={!cfg.apiKey || !!busy} aria-label={showKey ? "Hide API key" : "Show API key"} aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {(cfg.apiKey || savedKey) && <button type="button" disabled={!!busy} onClick={() => update({ apiKey: "" })} className="btn-ghost rounded-full">Clear key</button>}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{keyChanged && !cfg.apiKey ? "Save changes to remove this provider's saved key." : local ? "Leave blank if your local server does not require authentication." : "Use a developer API key from the selected provider. A chat subscription may not include API access."}</p>
          {keyNotice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{keyNotice}</p>}
        </div>

        <div className="space-y-2">
          <label className="label" htmlFor="ai-model">Model</label>
          <div className="flex flex-wrap gap-2">
            <input id="ai-model" className="input min-w-0 flex-1 basis-48" disabled={!!busy} value={cfg.model} onChange={event => update({ model: event.target.value })}
              placeholder={local ? "Enter an installed model ID" : "Enter a model ID or find models"} />
            <button type="button" className="btn-ghost rounded-full" disabled={!!busy || !aiEndpoint(cfg.baseUrl) || (!local && !keyAvailable)} onClick={() => void run("models")}>
              <RefreshCw size={15} className={busy === "models" ? "animate-spin" : ""} />
              {busy === "models" ? "Finding models…" : local ? "Find local models" : "Find models"}
            </button>
          </div>
          {modelMessage && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{modelMessage}</p>}
          {models.length > 0 && <select className="input" aria-label={local ? "Available local models" : "Available models"} disabled={!!busy} value={models.includes(cfg.model) ? cfg.model : ""}
            onChange={event => update({ model: event.target.value })}>
            <option value="" disabled>Choose a model</option>
            {models.map(model => <option key={model}>{model}</option>)}
          </select>}
          <p className="text-xs leading-relaxed text-muted-foreground">Choose a model with tool calling for business actions and vision for document images.</p>
        </div>

        <details className="group border-t border-border pt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>Advanced connection details</span><ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 pt-3">
            <div className="space-y-2">
              <label className="label" htmlFor="ai-protocol">API format</label>
              <select id="ai-protocol" className="input" disabled={!!busy} value={cfg.provider} onChange={event => {
                const provider = event.target.value as AiProvider;
                const selected = PRESETS.find(p => p.provider === provider);
                update({ provider, baseUrl: PROVIDER_DEFAULT_URL[provider], model: selected?.model ?? "" });
              }}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic (Claude)</option></select>
            </div>
            <div className="space-y-2">
              <label className="label" htmlFor="ai-base-url">API base URL</label>
              <input id="ai-base-url" className="input" disabled={!!busy} value={cfg.baseUrl} onChange={event => update({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
              <p className="text-xs leading-relaxed text-muted-foreground">Use the base URL from your provider, without /chat/completions or /messages.</p>
            </div>
          </div>
        </details>
        {result && <div role={result.ok ? "status" : "alert"} className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm leading-relaxed ${result.ok ? "border-border bg-muted/40 text-foreground" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
          {result.ok ? <Check size={17} className="mt-0.5 shrink-0" /> : <CircleAlert size={17} className="mt-0.5 shrink-0" />}
          <p className="min-w-0 break-words">{result.text}</p>
        </div>}
      </SettingsSection>

      <SettingsSection title="Privacy & storage" description={desktop ? "Saved securely on this device." : "Keys stay in this browser session."}>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{desktop ? "Keys are kept in your operating system's secure store, separately for each account and workspace." : "Browser keys stay in memory and are cleared on reload or sign-out. Use the desktop app to keep keys in your operating system's secure store."} Requests go to your selected provider.</p>
        {!desktop && <p className="text-[13px] leading-relaxed text-muted-foreground">The localhost preview supports the listed hosted providers. A deployed browser version requires the provider to allow browser requests; the desktop app also supports custom endpoints.</p>}
        <p className="text-[13px] leading-relaxed text-muted-foreground">Downloaded local models need no provider key. Hosted free tiers require your own account and have usage limits.</p>
      </SettingsSection>
    </SettingsPanel>
  );
}
