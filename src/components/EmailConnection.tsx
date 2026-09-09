import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw } from "lucide-react";
import { supabase, invokeFn } from "../lib/supabase";
import { edgeErrorMessage } from "../lib/email";

export default function EmailConnection() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
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
      if (error) throw new Error(await edgeErrorMessage(error));
      const result = data as { configured?: boolean; from?: string; error?: string };
      if (result?.error) throw new Error(result.error);
      setStatus(
        result?.configured
          ? `Resend is configured. Sender: ${result.from}. Delivery still depends on the sender domain and available quota.`
          : "The administrator needs to configure RESEND_API_KEY and EMAIL_FROM in Supabase secrets."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card mb-5">
      <div className="flex items-start gap-3">
        <Mail size={20} className="mt-1" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Transactional email · Resend</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Send invoices and quotations from their document actions. Credentials stay on
            the server; each send is recorded in Communications.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 flex-wrap">
        <button className="btn-secondary" onClick={() => void check()} disabled={busy}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Check configuration"}
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
        Checking configuration sends no email. Resend free-tier quotas and Filey's daily
        sending limits apply.
      </p>
    </section>
  );
}
