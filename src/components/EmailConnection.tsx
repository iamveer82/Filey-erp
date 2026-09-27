import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw } from "lucide-react";
import { supabase, invokeFn } from "../lib/supabase";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "../lib/agentStorage";
import { edgeErrorMessage } from "../lib/email";

export default function EmailConnection() {
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
      if (!supabase) throw new Error("Sign in to check cloud email.");
      const { data, error } = await invokeFn(
        supabase,
        "send-email",
        { body: { action: "status" } },
        0
      );
      if (scope !== agentStorageScope()) return;
      if (error) throw new Error(await edgeErrorMessage(error));
      const result = data as { configured?: boolean; from?: string; error?: string };
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
