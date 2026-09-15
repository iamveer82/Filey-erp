import { useEffect, useState } from "react";
import { Mail, Phone, MessageCircle, Plus, Loader2, Trash2 } from "lucide-react";

import { emailLog, callLog, type EmailMessage, type CallLog } from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { fmtDate, errMsg, cn } from "../lib/format";
import { Badge, Modal, Field, ErrorBanner, PageHeader } from "../components/ui";
import MessageOutbox from "../components/MessageOutbox";
import { SelectMenu } from "../components/ui-menu";

/* Correspondence: what was emailed, and what was said on the phone.
 *
 * Filey could already send email but kept no record, so "did we ever send them
 * that invoice" had no answer. Calls had nothing at all. Both are logged
 * against the same (entity_type, entity_id) pair the link graph uses, so a
 * customer's page can show its own correspondence.
 *
 * This is not an inbox. Receiving mail needs inbound MX and a webhook this
 * project does not have — everything here is outbound, which is what an ERP
 * actually sends.
 */

const mmss = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function Comms() {
  const { toast, confirm } = useUI();
  const [tab, setTab] = useState<"email" | "calls" | "whatsapp">("email");
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([
      emailLog.list(),
      callLog.list(),
    ]).then(([e, c]) => { setEmails(e); setCalls(c); setError(""); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const removeCall = async (c: CallLog) => {
    const ok = await confirm({
      title: "Delete call record",
      message: `Remove the call with ${c.contact_name || c.contact_phone || "this contact"}?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await callLog.remove(c.id);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Comms log"
        subtitle="Every email this workspace sent, and every call you record against a customer."
        action={tab === "calls" && (
          <button className="btn-primary" onClick={() => setLogging(true)}>
            <Plus size={15} /> Log a call
          </button>
        )}
      />

      <div className="mb-4 flex gap-1">
        {(["email", "calls", "whatsapp"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "chip",
              tab === t && "chip-active"
            )}
          >
            {t === "email" ? <Mail size={13} /> : t === "calls" ? <Phone size={13} /> : <MessageCircle size={13} />}
            {t === "email" ? `Email (${emails.length})` : t === "calls" ? `Calls (${calls.length})` : "WhatsApp invoices"}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><ErrorBanner message={`Could not load communication history: ${error}`} /><button className="btn-ghost mt-2" onClick={() => void load()}>Retry</button></div>}
      {tab === "whatsapp" ? <MessageOutbox /> : loading ? (
        <p className="flex items-center gap-2 py-6 text-[12.5px] text-brand-400">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : tab === "email" ? (
        emails.length === 0 ? (
          <p className="card p-6 text-center text-[12.5px] text-brand-400">
            Nothing sent yet. Emailing an invoice or a statement records it here.
          </p>
        ) : (
          <div className="card divide-y divide-border">
            {emails.map((e) => (
              <div key={e.id} className="flex items-start gap-3 p-3">
                <Mail size={15} className="mt-0.5 shrink-0 text-brand-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {e.subject || "(no subject)"}
                  </p>
                  <p className="truncate text-[12.5px] text-brand-500">
                    To {e.to_name ? `${e.to_name} <${e.to_email}>` : e.to_email}
                  </p>
                  {e.status === "failed" && e.error && (
                    <p className="mt-0.5 text-[11px] text-danger">{e.error}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={e.status === "failed" ? "danger" : "success"}>{e.status}</Badge>
                  <p className="mt-1 text-[11px] text-brand-400">{fmtDate(e.sent_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : calls.length === 0 ? (
        <p className="card p-6 text-center text-[12.5px] text-brand-400">
          No calls logged. Recording what was agreed on a call is what makes it
          searchable later.
        </p>
      ) : (
        <div className="card divide-y divide-border">
          {calls.map((c) => (
            <div key={c.id} className="group flex items-start gap-3 p-3">
              <Phone size={15} className="mt-0.5 shrink-0 text-brand-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {c.contact_name || c.contact_phone || "Unknown contact"}
                </p>
                {c.notes && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] text-brand-500">
                    {c.notes}
                  </p>
                )}
                {c.outcome && (
                  <p className="mt-0.5 text-[11px] text-brand-400">Outcome: {c.outcome}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <Badge tone={c.direction === "missed" ? "warn" : "info"}>{c.direction}</Badge>
                <p className="mt-1 text-[11px] text-brand-400">
                  {fmtDate(c.started_at)}
                  {c.duration_secs > 0 && ` · ${mmss(c.duration_secs)}`}
                </p>
              </div>
              <button
                className="btn-ghost w-10 shrink-0 p-0 text-muted-foreground hover:text-danger"
                onClick={() => removeCall(c)}
                aria-label="Delete call record"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {logging && (
        <LogCallModal
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function LogCallModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const [direction, setDirection] = useState<"outgoing" | "incoming" | "missed">("outgoing");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [minutes, setMinutes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!name.trim() && !phone.trim()) {
      toast.error("Add a name or a number so the call is findable.");
      return;
    }
    if (!Number.isFinite(Number(minutes)) || Number(minutes) < 0) {
      toast.error("Enter a duration of zero minutes or more.");
      return;
    }
    setBusy(true);
    try {
      await callLog.add({
        direction,
        contact_name: name.trim() || undefined,
        contact_phone: phone.trim() || undefined,
        // Entered in minutes because that is how people remember a call;
        // stored in seconds so short calls are not all rounded to zero.
        duration_secs: Math.round((Number(minutes) || 0) * 60),
        outcome: outcome.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Log a call" onClose={() => { if (!busy) onClose(); }}>
      <fieldset disabled={busy} className="space-y-3">
        <Field label="Direction">
          <SelectMenu
            value={direction}
            onChange={(v) => setDirection(v as typeof direction)}
            options={[
              { value: "outgoing", label: "Outgoing" },
              { value: "incoming", label: "Incoming" },
              { value: "missed", label: "Missed" },
            ]}
          />
        </Field>
        <Field label="Contact">
          <input
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            type="tel"
            placeholder="+971…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            className="input"
            inputMode="decimal"
            type="number"
            min="0"
            step="any"
            placeholder="5"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
        <Field label="Outcome">
          <input
            className="input"
            placeholder="Agreed to pay on Friday"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="textarea"
            placeholder="What was discussed"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button className="btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save call"}
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}
