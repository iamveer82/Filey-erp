import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw, Save, Trash2, ExternalLink } from "lucide-react";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { checkHostedEmailConnection } from "../lib/email";
import { isLocalMode } from "../lib/dataMode";
import { CREDENTIAL_EVENT } from "../lib/credentialStore";
import { checkLocalEmailSetup, clearLocalEmailConnection, personalEmailAvailable, personalEmailDesktop,
  readLocalEmailConnection, saveLocalEmailConnection, PERSONAL_EMAIL_APP_REQUIRED } from "../lib/localEmail";
import { SettingsPanel, SettingsSection } from "./SettingsLayout";

export default function EmailConnection() {
  const [scope, setScope] = useState(agentStorageScope());
  useEffect(() => {
    const changed = () => setScope(agentStorageScope());
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, changed);
  }, []);
  return isLocalMode() ? <PersonalEmailConnection key={scope ?? "signed-out"} /> : <HostedEmailConnection key={scope ?? "signed-out"} />;
}

function PersonalEmailConnection() {
  const [scope] = useState(agentStorageScope);
  const [config, setConfig] = useState(readLocalEmailConnection);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const current = () => scope !== null && scope === agentStorageScope() && isLocalMode();
  useEffect(() => {
    const changed = () => setConfig(value => ({ ...value, keyStored: readLocalEmailConnection().keyStored }));
    window.addEventListener(CREDENTIAL_EVENT, changed);
    return () => window.removeEventListener(CREDENTIAL_EVENT, changed);
  }, []);
  const run = async (action: "save" | "check" | "clear") => {
    if (!current()) return;
    setBusy(true); setStatus("");
    try {
      if (action === "save") await saveLocalEmailConnection(config, key, scope!);
      else if (action === "clear") await clearLocalEmailConnection(scope!);
      else await checkLocalEmailSetup(scope!);
      if (!current()) return;
      if (action !== "check") { setConfig(readLocalEmailConnection()); setKey(""); }
      setStatus(action === "save" ? "Email setup saved. No email was sent." : action === "clear" ? "Personal email connection removed." :
        "Setup is ready in this app. No email was sent. Resend verifies the key and sender when you send a real email.");
    } catch (error) {
      if (current()) setStatus(error instanceof Error ? error.message : "Could not update personal email setup.");
    } finally { if (current()) setBusy(false); }
  };
  return <SettingsPanel>
    <SettingsSection title="Personal email" description="Local mode sends email through your own Resend account. Filey does not pay for or store these messages in its cloud.">
      <p className="text-sm leading-relaxed text-muted-foreground">Resend receives the recipient, message and attachments to deliver your email. Your workspace and communication history stay on this device. Your Resend account's sending limits and charges apply.</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn-ghost" href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">Get a Resend key<ExternalLink size={13} /></a>
        <a className="btn-ghost" href="https://resend.com/domains" target="_blank" rel="noopener noreferrer">Verify your sender domain<ExternalLink size={13} /></a>
      </div>
      {!personalEmailAvailable() && <p className="rounded-lg border border-border p-3 text-sm">{PERSONAL_EMAIL_APP_REQUIRED}</p>}
    </SettingsSection>
    <SettingsSection title="Connection" description="Use a sending-access key and an email address on a domain you have verified in Resend."
      actions={<>
        <button type="button" className="btn-ghost" disabled={busy || (!config.keyStored && !config.senderEmail)} onClick={() => void run("clear")}><Trash2 size={14} />Remove connection</button>
        <button type="button" className="btn-secondary" disabled={busy || !config.keyStored || !!key.trim()} onClick={() => void run("check")}><RefreshCw size={14} />Check saved setup</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void run("save")}><Save size={14} />{busy ? "Working…" : "Save email setup"}</button>
      </>}>
      <div className="space-y-2">
        <label className="label" htmlFor="email-resend-key">Resend API key</label>
        <input id="email-resend-key" className="input w-full" type="password" autoComplete="off" spellCheck={false} disabled={busy}
          value={key} onChange={event => setKey(event.target.value)} placeholder={config.keyStored ? "Saved key · enter a new key to replace" : "re_…"} />
        <p className="text-xs text-muted-foreground">{personalEmailDesktop() ? "Your key is kept in this account's device vault. It is never stored in Filey's cloud." : "Your key is kept in memory for this session only. Reconnect after reloading or signing out."}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><label className="label" htmlFor="email-sender">Verified sender email</label><input id="email-sender" className="input w-full" type="email" disabled={busy} required value={config.senderEmail}
          onChange={event => setConfig(value => ({ ...value, senderEmail: event.target.value }))} placeholder="accounts@yourcompany.com" /></div>
        <div className="space-y-2"><label className="label" htmlFor="email-sender-name">Sender name (optional)</label><input id="email-sender-name" className="input w-full" disabled={busy} value={config.senderName}
          onChange={event => setConfig(value => ({ ...value, senderName: event.target.value }))} placeholder="Your company" /></div>
      </div>
      <p className="text-xs text-muted-foreground">Saving or checking setup sends no email. Filey never retries automatically or switches to its hosted sender if this connection fails.</p>
      {status && <p role="status" className="border-t border-border pt-3 text-sm">{status}</p>}
    </SettingsSection>
    <SettingsSection title="Communication history" description="Review email attempts saved on this device."><Link className="btn-ghost" to="/comms">Communication history</Link></SettingsSection>
  </SettingsPanel>;
}

function HostedEmailConnection() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let scope = agentStorageScope();
    const changed = () => { if (scope !== agentStorageScope()) { scope = agentStorageScope(); setStatus(""); setBusy(false); } };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, changed);
  }, []);
  const check = async () => {
    const scope = agentStorageScope();
    setBusy(true);
    setStatus("");
    try {
      const result = await checkHostedEmailConnection();
      if (scope !== agentStorageScope()) return;
      if (result?.error) throw new Error(result.error);
      setStatus(
        result?.configured
          ? `Email is connected${result.from ? `. Sender: ${result.from}` : ""}. Sending limits apply.`
          : "Email isn't set up yet. Ask your workspace administrator to complete the email setup guide."
      );
    } catch (error) {
      if (scope === agentStorageScope()) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (scope === agentStorageScope()) setBusy(false);
    }
  };
  return (
    <section className="card mb-5">
      <div className="flex items-start gap-3">
        <Mail size={20} className="mt-1" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Email delivery</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Send invoices and quotations from their document actions. See sent messages
            in Communication history.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 flex-wrap">
        <button className="btn-secondary" onClick={() => void check()} disabled={busy}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Check connection"}
        </button>
        <Link className="btn-ghost" to="/comms">
          Communication history
        </Link>
        <Link className="btn-ghost" to="/docs?article=email">
          Email setup guide
        </Link>
      </div>
      {status && (
        <p role="status" className="mt-4 text-sm border-t border-border pt-3">
          {status}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        Checking the connection sends no email. Your workspace's email service and daily sending limits apply.
      </p>
    </section>
  );
}
