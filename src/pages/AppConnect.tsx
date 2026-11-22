import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, Plug, RefreshCw, Zap } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge, ErrorBanner, Field, Modal, PageHeader } from "../components/ui";
import { useUI } from "../lib/ui";
import { errMsg, fmtDate } from "../lib/format";
import { isNativeApp, openNativeExternal } from "../lib/nativePlatform";
import { agentStorageScope } from "../lib/agentStorage";
import { COMPOSIO_TOOLKITS, composioConnect, composioKeySource, composioStatus, hasDesktop } from "../lib/composio";
import {
  activeConnection, appEventTypes, appEventsOn, describeAppEvent, eventName, recentAppEvents, turnOffAppEvent, turnOnAppEvent,
  type AppEvent, type AppEventOn, type AppEventType, type ConfigField,
} from "../lib/appEvents";

/* One page per connected app: sign it in, turn on the events it can send to
 * Filey, and see what arrived. Automations pick these up with "a connected app
 * sends an event"; the agent reads them with list_app_events. */

export default function AppConnect() {
  const { toolkit: raw } = useParams<{ toolkit: string }>();
  const toolkit = /^[a-z0-9_-]{1,64}$/.test(raw ?? "") ? raw! : "";
  // The directory passes what it showed on the tile, so an app found by search
  // keeps its real name, description and logo here.
  const hint = (useLocation().state ?? {}) as { name?: string; desc?: string; logo?: string };
  const listed = COMPOSIO_TOOLKITS.find((t) => t.slug === toolkit);
  const name = listed?.name ?? hint.name ?? toolkit.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const about = listed?.desc ?? hint.desc ?? "";
  const [logoOk, setLogoOk] = useState(true);
  const { toast } = useUI();

  const [account, setAccount] = useState<string | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const [types, setTypes] = useState<AppEventType[]>([]);
  const [on, setOn] = useState<AppEventOn[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [setup, setSetup] = useState<AppEventType | null>(null);
  /** The sign-in address, kept on screen in a browser where a popup can be blocked. */
  const [signIn, setSignIn] = useState("");

  const load = useCallback(async () => {
    if (!toolkit) return;
    setError("");
    try {
      const source = await composioKeySource();
      setOwnKey(source === "own");
      if (source === "none") { setError("Sign in to your Filey account to connect apps."); return; }
      const id = await activeConnection(toolkit);
      setAccount(id);
      if (source === "own" || !id) return;
      const [t, o, e] = await Promise.all([appEventTypes(toolkit), appEventsOn(), recentAppEvents({ toolkit, limit: 20 })]);
      setTypes(t);
      setOn(o.filter((x) => x.toolkit === toolkit));
      setEvents(e);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [toolkit]);
  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    // A sign-in that started under one account must never open or finish under another.
    const scope = agentStorageScope();
    const same = () => scope !== null && scope === agentStorageScope();
    setBusy("connect");
    try {
      const link = await composioConnect(toolkit);
      if (!same()) return;
      if (!link.redirect_url || !link.connected_account_id) throw new Error("The app did not return a sign-in link.");
      if (isNativeApp()) await openNativeExternal(link.redirect_url);
      else if (hasDesktop) await openUrl(link.redirect_url);
      else { window.open(link.redirect_url, "_blank", "noopener,noreferrer"); setSignIn(link.redirect_url); }
      toast.success(`Sign in to ${name} in the browser window. This page updates when you're done.`);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!same()) return;
        const status = String((await composioStatus(link.connected_account_id)).status ?? "").toUpperCase();
        if (status === "ACTIVE") { toast.success(`${name} connected.`); await load(); return; }
        if (["FAILED", "EXPIRED", "INACTIVE"].includes(status)) throw new Error("The sign-in was not completed. Try again.");
      }
      toast.error("Still waiting for the sign-in. Finish it in the browser, then refresh this page.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
      setSignIn("");
    }
  };

  const enable = async (type: AppEventType, config: Record<string, unknown> = {}) => {
    setBusy(type.slug);
    try {
      await turnOnAppEvent(toolkit, type.slug, config);
      setSetup(null);
      toast.success(`${eventName(type.slug, toolkit)} is on.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const disable = async (row: AppEventOn) => {
    setBusy(row.trigger_slug);
    try {
      await turnOffAppEvent(row.id);
      toast.success(`${eventName(row.trigger_slug, toolkit)} is off.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const needsSettings = (type: AppEventType) => Object.keys(type.config?.properties ?? {}).length > 0;

  return (
    <div>
      <PageHeader
        title={name || "Unknown app"}
        subtitle={about || "Connect it, then choose what it tells Filey"}
        action={<Link to="/integrations" className="btn-secondary"><ArrowLeft size={15} /> Integrations</Link>}
      />
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {!toolkit ? null : (
        <>
          <section className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              {logoOk
                ? <img src={hint.logo || `https://logos.composio.dev/api/${toolkit}`} alt="" width={28} height={28}
                    className="h-7 w-7 rounded object-contain" onError={() => setLogoOk(false)} />
                : <Plug size={18} className="text-muted" />}
              <div>
                <p className="text-sm font-medium text-ink">{loading ? "Checking…" : account ? "Connected" : "Not connected"}</p>
                <p className="text-xs text-muted">The agent can use {name} once it is connected.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={loading || !!busy} onClick={() => { setLoading(true); void load(); }} aria-label="Refresh">
                <RefreshCw size={15} />
              </button>
              <button className={account ? "btn-ghost" : "btn-primary"} disabled={loading || !!busy} onClick={connect}>
                {busy === "connect" ? "Waiting for sign-in…" : account ? "Reconnect" : `Connect ${name}`}
              </button>
            </div>
          </section>
          {signIn && (
            <p className="mb-4 text-[13px] text-muted">
              If the sign-in window did not open,{" "}
              <a className="font-medium text-ink underline underline-offset-4" href={signIn} target="_blank" rel="noopener noreferrer">open the {name} sign-in page</a>.
            </p>
          )}
          {!loading && !account && !error && !ownKey && (
            <section className="card mb-4 p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">How it works</h2>
              <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
                <li>Press <strong className="text-ink">Connect {name}</strong> and sign in to {name} in the window that opens.</li>
                <li>Come back here and turn on the events {name} should send to Filey.</li>
                <li>Add an automation that runs when “a connected app sends an event”, or ask the agent to use {name}.</li>
              </ol>
            </section>
          )}

          {ownKey ? (
            <p className="card p-4 text-sm text-muted">
              Live events come through Filey's own Composio connection. You are using your own Composio key, so
              turn that off in Integrations to receive events here.
            </p>
          ) : account && (
            <>
              <section className="card mb-4 p-4">
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><Zap size={15} /> Live events</h2>
                <p className="mb-3 text-xs text-muted">
                  Turn on what {name} should send Filey. To act on them, add an automation that runs when
                  “a connected app sends an event”.
                </p>
                {types.length === 0 ? (
                  <p className="text-sm text-muted">{loading ? "Loading…" : `${name} has no live events to offer.`}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {types.map((type) => {
                      const row = on.find((x) => x.trigger_slug === type.slug.toUpperCase());
                      return (
                        <li key={type.slug} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">{type.name || eventName(type.slug, toolkit)}</p>
                            {type.description && <p className="line-clamp-2 text-xs text-muted">{type.description}</p>}
                          </div>
                          {row ? (
                            <button className="btn-ghost text-sm" disabled={!!busy} onClick={() => disable(row)}>
                              {busy === row.trigger_slug ? "Turning off…" : <><Badge tone="success">On</Badge> Turn off</>}
                            </button>
                          ) : (
                            <button className="btn-secondary text-sm" disabled={!!busy}
                              onClick={() => (needsSettings(type) ? setSetup(type) : enable(type))}>
                              {busy === type.slug ? "Turning on…" : "Turn on"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Recent events</h2>
                {events.length === 0 ? (
                  <p className="text-sm text-muted">Nothing has arrived yet. Events show here within seconds of {name} sending them.</p>
                ) : (
                  <ul className="space-y-2">
                    {events.map((event) => (
                      <li key={event.id} className="text-sm">
                        <span className="text-xs text-muted">{fmtDate(event.received_at)} </span>
                        <span className="text-ink">{describeAppEvent(event)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
      {setup && <SettingsModal type={setup} toolkit={toolkit} busy={!!busy} onClose={() => setSetup(null)} onSave={(config) => enable(setup, config)} />}
    </div>
  );
}

/** The few settings an event needs (a label to watch, a sheet id…), from the app's own schema. */
function SettingsModal({ type, toolkit, busy, onClose, onSave }: {
  type: AppEventType; toolkit: string; busy: boolean; onClose: () => void; onSave: (config: Record<string, unknown>) => void;
}) {
  const fields = Object.entries(type.config?.properties ?? {}) as [string, ConfigField][];
  const required = new Set(type.config?.required ?? []);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map(([key, f]) => [key, f.type === "boolean" ? f.default === true : f.default == null ? "" : String(f.default)])));
  const missing = fields.some(([key]) => required.has(key) && values[key] === "");

  const save = () => {
    const config: Record<string, unknown> = {};
    for (const [key, f] of fields) {
      const value = values[key];
      if (value === "") continue;
      config[key] = f.type === "integer" || f.type === "number" ? Number(value) : value;
    }
    onSave(config);
  };

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={type.name || eventName(type.slug, toolkit)}>
      <fieldset disabled={busy} className="space-y-3">
        {type.instructions && <p className="text-xs text-muted">{type.instructions}</p>}
        {fields.map(([key, f]) => (
          <Field key={key} label={`${f.title || key}${required.has(key) ? " *" : ""}`}>
            {f.type === "boolean" ? (
              <input type="checkbox" checked={values[key] === true} onChange={(e) => setValues({ ...values, [key]: e.target.checked })} />
            ) : (
              <input className="input" type={f.type === "integer" || f.type === "number" ? "number" : "text"}
                placeholder={f.description?.slice(0, 80)} value={String(values[key] ?? "")}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
            )}
          </Field>
        ))}
      </fieldset>
      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <button className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || missing} onClick={save}>Turn on</button>
      </div>
    </Modal>
  );
}
