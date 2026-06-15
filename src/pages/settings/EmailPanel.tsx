import {
  loadEmailConfig,
  saveEmailConfig,
  sendEmail,
  emailShell,
  hasDesktop,
  type EmailConfig,
} from "../../lib/email";
import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Field } from "../../components/ui";
import BrandIcon from "../../components/BrandIcon";
import { numInput } from "../../lib/format";

/* ---------------- Email (Gmail SMTP) ---------------- */

export default function EmailPanel() {
  const [cfg, setCfg] = useState<EmailConfig>({
    host: "smtp.gmail.com",
    port: 587,
    username: "",
    password: "",
    from_name: "",
    from_email: "",
  });
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; msg: string }>({
    busy: false,
    msg: "",
  });
  const [c, setC] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState<{ busy: boolean; msg: string }>({
    busy: false,
    msg: "",
  });

  useEffect(() => {
    loadEmailConfig().then((v) => v && setCfg((p) => ({ ...p, ...v })));
  }, []);

  const set = (k: keyof EmailConfig, v: string | number) => {
    setCfg({ ...cfg, [k]: v });
    setSaved(false);
  };

  const save = async () => {
    const next = { ...cfg, from_email: cfg.username };
    setCfg(next);
    try {
      await saveEmailConfig(next);
      setSaved(true);
    } catch (e) {
      setTest({
        busy: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const sendTest = async () => {
    setTest({ busy: true, msg: "" });
    try {
      await saveEmailConfig({ ...cfg, from_email: cfg.username });
      await sendEmail({
        to: cfg.username,
        subject: "Filey ERP — test email",
        html: emailShell(
          "It works!",
          "<p>Your Gmail SMTP connection is configured correctly.</p>"
        ),
      });
      setTest({ busy: false, msg: "Test email sent — check your inbox." });
    } catch (e) {
      setTest({
        busy: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const compose = async () => {
    setSending({ busy: true, msg: "" });
    try {
      await sendEmail({
        to: c.to,
        subject: c.subject,
        html: emailShell(
          c.subject || "Message",
          `<p>${c.body.replace(/\n/g, "<br/>")}</p>`
        ),
      });
      setSending({ busy: false, msg: "Sent." });
      setC({ to: "", subject: "", body: "" });
    } catch (e) {
      setSending({
        busy: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <BrandIcon name="gmail" className="h-5 w-5" />
          <p className="font-medium text-ink">Email connection (Gmail SMTP)</p>
        </div>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Connect your Gmail to send invoices, quotations and alerts. Use a{" "}
          <b>Gmail App Password</b> (Google Account → Security → 2-Step Verification → App
          passwords) — not your normal password.
        </p>
        {!hasDesktop && (
          <p className="text-xs font-medium text-warning bg-warning/10 rounded-3xl px-3 py-2 mb-4">
            You can save settings here, but email is only sent from the Filey desktop app.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="From name">
            <input
              className="input"
              placeholder="Acme Trading"
              value={cfg.from_name}
              onChange={(e) => set("from_name", e.target.value)}
            />
          </Field>
          <Field label="Gmail address">
            <input
              className="input"
              placeholder="you@gmail.com"
              value={cfg.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>
          <Field label="App password">
            <input
              type="password"
              className="input"
              placeholder="16-character app password"
              value={cfg.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="SMTP host">
              <input
                className="input"
                value={cfg.host}
                onChange={(e) => set("host", e.target.value)}
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                className="input"
                value={cfg.port}
                onChange={(e) => set("port", numInput(e.target.value) || 587)}
              />
            </Field>
          </div>
        </div>
        <p className="text-[11px] text-brand-400 mt-2">
          Stored locally on this device — never synced to the cloud.
        </p>
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button className="btn-primary" onClick={save}>
            {saved ? "Saved" : "Save connection"}
          </button>
          <button
            className="btn-ghost"
            disabled={test.busy || !cfg.username || !cfg.password}
            onClick={sendTest}
          >
            <Send size={14} /> {test.busy ? "Sending…" : "Send test"}
          </button>
          {test.msg && (
            <span className="text-xs font-medium text-brand-600">{test.msg}</span>
          )}
        </div>
      </div>

      <div className="card">
        <p className="font-medium text-ink mb-3">Compose &amp; send</p>
        <div className="space-y-3">
          <Field label="To">
            <input
              className="input"
              placeholder="customer@example.com"
              value={c.to}
              onChange={(e) => setC({ ...c, to: e.target.value })}
            />
          </Field>
          <Field label="Subject">
            <input
              className="input"
              value={c.subject}
              onChange={(e) => setC({ ...c, subject: e.target.value })}
            />
          </Field>
          <Field label="Message">
            <textarea
              className="textarea"
              rows={5}
              value={c.body}
              onChange={(e) => setC({ ...c, body: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={sending.busy || !c.to.trim()}
              onClick={compose}
            >
              <Send size={15} /> {sending.busy ? "Sending…" : "Send email"}
            </button>
            {sending.msg && (
              <span className="text-xs font-medium text-brand-600">{sending.msg}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
