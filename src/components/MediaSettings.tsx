import { useEffect, useId, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { SettingsSection } from "./SettingsLayout";
import { FileySpinner } from "./FileySpinner";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { getCacheScope } from "../lib/api";
import { getImageConfig, imageCredential, setImageConfig } from "../lib/aiImage";
import {
  CREDENTIAL_EVENT,
  flushCredentials,
  hasCredential,
  saveCredential,
} from "../lib/credentialStore";
import {
  MEDIA_MODELS,
  getMediaConfig,
  mediaCredential,
  saveMediaConfig,
  type MediaKind,
} from "../lib/aiMedia";
import { aiEndpoint, isLocalAiEndpoint } from "../lib/aiEndpoint";

export default function MediaSettings() {
  const [scope, setScope] = useState(agentStorageScope);
  useEffect(() => {
    const change = () => setScope(agentStorageScope());
    window.addEventListener(AGENT_STORAGE_EVENT, change);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, change);
  }, []);
  return (
    <>
      <MediaProvider key={`${scope}:image`} kind="image" />
      <MediaProvider key={`${scope}:video`} kind="video" />
    </>
  );
}
function MediaProvider({ kind }: { kind: MediaKind }) {
  const id = useId();
  const [scope] = useState(agentStorageScope);
  const [owner] = useState(getCacheScope);
  const [config, setConfig] = useState(getMediaConfig);
  const [image, setImage] = useState(() => ({ ...getImageConfig(), apiKey: "" }));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fal = kind === "video" || config.imageProvider === "fal";
  const name = fal ? mediaCredential(kind) : imageCredential(image);
  const [saved, setSaved] = useState(() => hasCredential(name));
  useEffect(() => {
    const update = () => setSaved(hasCredential(name));
    update();
    window.addEventListener(CREDENTIAL_EVENT, update);
    return () => window.removeEventListener(CREDENTIAL_EVENT, update);
  }, [name]);
  async function save(remove = false) {
    if (!scope || !owner) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (scope !== agentStorageScope())
        throw new Error("Your workspace changed. Reopen settings.");
      if (remove) await saveCredential(name, null);
      else {
        if (!fal) {
          const url = aiEndpoint(image.baseUrl);
          if (
            image.baseUrl &&
            (!url ||
              (url.protocol !== "https:" &&
                !isLocalAiEndpoint({ provider: "openai", baseUrl: image.baseUrl })))
          )
            throw new Error("Use an HTTPS API URL, or a local server on this device.");
          if (!image.model.trim()) throw new Error("Enter your image model ID.");
          const { apiKey: _unused, ...settings } = image;
          setImageConfig(
            { ...settings, ...(key.trim() ? { apiKey: key.trim() } : {}) },
            owner
          );
          await flushCredentials(name);
        }
        const current = getMediaConfig();
        await saveMediaConfig(
          kind === "image"
            ? {
                ...current,
                imageProvider: config.imageProvider,
                imageModel: config.imageModel,
              }
            : { ...current, videoModel: config.videoModel, videoSource: "byok" },
          kind,
          fal && key.trim() ? key.trim() : undefined,
          scope
        );
      }
      if (scope !== agentStorageScope()) return;
      setKey("");
      setSaved(hasCredential(name));
      setNotice(
        remove
          ? "Key removed from this device."
          : "Media settings saved. No generation request was sent."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save media settings.");
    } finally {
      setBusy(false);
    }
  }
  const label = kind === "image" ? "Image" : "Video";
  return (
    <SettingsSection
      title={`${label} generation`}
      description={`${label}s appear directly in your Filey AI conversation. Your provider bills your own key; Filey credits are not used.`}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="space-y-2">
          <label className="label" htmlFor={`${id}-provider`}>
            Provider
          </label>
          <select
            id={`${id}-provider`}
            className="input"
            value={fal ? "fal" : "openai"}
            onChange={(e) => {
              setConfig({ ...config, imageProvider: e.target.value as "fal" | "openai" });
              setKey("");
              setNotice("");
            }}
          >
            {kind === "image" && (
              <option value="openai">OpenAI-compatible image API</option>
            )}
            <option value="fal">fal · bring your own key</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="label" htmlFor={`${id}-model`}>
            {label} model
          </label>
          {fal ? (
            <select
              id={`${id}-model`}
              className="input"
              value={kind === "image" ? config.imageModel : config.videoModel}
              onChange={(e) =>
                setConfig({
                  ...config,
                  [kind === "image" ? "imageModel" : "videoModel"]: e.target.value,
                })
              }
            >
              {MEDIA_MODELS.filter((m) => m.kind === kind).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${id}-model`}
              className="input"
              value={image.model}
              onChange={(e) => setImage({ ...image, model: e.target.value })}
              placeholder="Image model ID"
            />
          )}
          {kind === "video" && (
            <p className="text-xs text-muted-foreground">
              720p · approximately 5 or 10 seconds · silent · optional product photo.
            </p>
          )}
        </div>
        {!fal && (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <label className="label" htmlFor={`${id}-url`}>
                Image API base URL
              </label>
              <input
                id={`${id}-url`}
                className="input"
                value={image.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => {
                  setImage({ ...image, baseUrl: e.target.value });
                  setKey("");
                }}
              />
            </div>
            <div className="space-y-2">
              <label className="label" htmlFor={`${id}-size`}>
                Image size
              </label>
              <select
                id={`${id}-size`}
                className="input"
                value={image.size}
                onChange={(e) => setImage({ ...image, size: e.target.value })}
              >
                <option value="1024x1024">Square · 1024 × 1024</option>
                <option value="1536x1024">Landscape · 1536 × 1024</option>
                <option value="1024x1536">Portrait · 1024 × 1536</option>
              </select>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <label className="label" htmlFor={`${id}-key`}>
            {label} API key
          </label>
          <input
            id={`${id}-key`}
            type="password"
            className="input"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              saved
                ? "Key available · enter a replacement"
                : "Paste your own provider key"
            }
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {saved ? "A key is available for this provider. " : ""}
            {"__TAURI_INTERNALS__" in window
              ? "Stored in this device’s secure credential store."
              : "Kept only for this browser session. Enter it again after a reload."}
          </p>
          {!fal && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Blank URL uses the chat provider. Its key is reused only on the same
              provider. Mobile requires a provider that allows browser requests; fal
              supports this.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => void save()}>
            {busy ? <FileySpinner size={15} /> : <Check size={15} />}Save {kind} settings
          </button>
          {saved && (
            <button type="button" className="btn-ghost" onClick={() => void save(true)}>
              Remove key
            </button>
          )}
          {fal && (
            <a
              className="btn-ghost"
              href="https://fal.ai/dashboard/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              <KeyRound size={14} />
              Get a fal key
            </a>
          )}
        </div>
      </fieldset>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
