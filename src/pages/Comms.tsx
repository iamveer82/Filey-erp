import { useEffect, useState } from "react";
import { Mail, Phone, Plus, Loader2, Trash2 } from "lucide-react";

import { emailLog, callLog, type EmailMessage, type CallLog } from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { fmtDate, errMsg, cn } from "../lib/format";
import { Badge, Modal, Field } from "../components/ui";
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
  const [tab, setTab] = useState<"email" | "calls">("email");
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);

  const load = () =>
    Promise.all([
      emailLog.list().then(setEmails).catch(() => {}),
      callLog.list().then(setCalls).catch(() => {}),
    ]).finally(() => setLoading(false));

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
    <div className="mx-auto max-w-[1320px] px-4 py-4 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Comms log</h1>
          <p className="mt-1 text-[12.5px] text-brand-500">
            Every email this workspace sent, and every call you record against a
            customer.
          </p>
        </div>
        {tab === "calls" && (
          <button className="btn-primary" onClick={() => setLogging(true)}>
            <Plus size={15} /> Log a call
          </button>
        )}
      </header>

      <div className="mb-4 flex gap-1">
        {(["email", "calls"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              tab === t
                ? "bg-primary-100 text-ink"
                : "text-brand-500 hover:bg-muted hover:text-ink"
            )}
          >
            {t === "email" ? <Mail size={13} /> : <Phone size={13} />}
            {t === "email" ? `Email (${emails.length})` : `Calls (${calls.length})`}
          </button>
        ))}
      </div>

      {loading ? (
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
                className="shrink-0 text-brand-300 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
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
    if (!name.trim() && !phone.trim()) {
      toast.error("Add a name or a number so the call is findable.");
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
    <Modal open title="Log a call" onClose={onClose}>
      <div className="space-y-3">
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
            placeholder="+971…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            className="input"
            inputMode="decimal"
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
            className="input min-h-[80px]"
            placeholder="What was discussed"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : "Save call"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
