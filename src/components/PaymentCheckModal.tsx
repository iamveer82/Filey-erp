import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { fmtDate, money } from "../lib/format";
import { useUI } from "../lib/ui";
import { Modal } from "./ui";
import { Toggle } from "../pages/settings/PreferencesPanel";
import { parseAlert, type PaymentMatch } from "../lib/paymentAlerts";
import { checkPayments, confirmMatch, dismissAlert, setAutoCheck } from "../lib/paymentWatch";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const inr = (v: number) => money(v, "INR");

/** UPI payments seen in bank alerts, matched to unpaid invoices for the owner to confirm. */
export default function PaymentCheckModal({ open, onClose, onRecorded }: { open: boolean; onClose: () => void; onRecorded: () => void }) {
  const { toast } = useUI();
  const [matches, setMatches] = useState<PaymentMatch[]>([]);
  const [gmail, setGmail] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(true);
  const [lastChecked, setLastChecked] = useState("");
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [pick, setPick] = useState<Record<string, number>>({});

  const run = useCallback(async (pasted?: string) => {
    setBusy(true);
    try {
      const extra = [];
      if (pasted !== undefined) {
        const alert = parseAlert(pasted, "pasted", "", "");
        if (!alert) { toast.error("This doesn't read as a money-received alert. Paste the whole bank SMS or email."); return; }
        extra.push(alert);
      }
      const result = await checkPayments(extra, pasted === undefined);
      setMatches(result.matches); setGmail(result.gmail); setAuto(result.state.auto !== false); setLastChecked(result.state.lastChecked ?? "");
      if (pasted !== undefined) {
        setPaste("");
        if (!result.added.length) toast.info("Already checked: this payment reference was seen before.");
      }
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    // toast is recreated each render; checking must not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (open) void run(); }, [open, run]);

  const record = async (m: PaymentMatch, invoiceId: number) => {
    setBusy(true);
    try {
      await confirmMatch(m.alert, invoiceId);
      const inv = m.candidates.find((c) => c.id === invoiceId);
      toast.success(`Recorded ${inr(m.alert.amount)} on ${inv?.number ?? "the invoice"}.`);
      setMatches(matches.filter((x) => x.alert.key !== m.alert.key));
      onRecorded();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const dismiss = async (key: string) => {
    try { await dismissAlert(key); setMatches(matches.filter((x) => x.alert.key !== key)); } catch (e) { toast.error(errMsg(e)); }
  };

  return <Modal open={open} onClose={onClose} title="UPI payment check" size="2xl">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-lg text-xs text-muted-foreground">
        Filey reads your bank's "credited" alerts and matches each one to an unpaid invoice with exactly that balance.
        Alerts can be forged, so only known bank senders are read, each UPI reference counts once, and nothing is recorded until you confirm.
      </p>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => { void run(); }}><RefreshCw size={14} /> {busy ? "Checking…" : "Check now"}</button>
    </div>
    <div className="mb-4 rounded-xl border border-border p-3 text-sm">
      {gmail === null ? <p className="text-muted-foreground">Checking connections…</p> : gmail
        ? <p><span className="font-medium text-ink">Gmail connected.</span> Bank emails, and bank SMS your phone forwards to this inbox, are read every few minutes while Filey is open.</p>
        : <p>Connect Gmail under <Link className="underline" to="/integrations">Integrations</Link> to check bank emails automatically. For bank SMS, have an SMS-forwarding app on the phone send them to that Gmail, or paste one below.</p>}
      <label className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Check automatically{lastChecked ? ` · last checked ${new Date(lastChecked).toLocaleTimeString()}` : ""}</span>
        <Toggle label="Check payments automatically" on={auto} onChange={() => { const next = !auto; setAuto(next); setAutoCheck(next).catch((e) => { setAuto(!next); toast.error(errMsg(e)); }); }} />
      </label>
    </div>

    {matches.length === 0 ? <p className="mb-4 rounded-xl border border-border p-3 text-sm text-muted-foreground">No payments waiting. New ones show up here.</p> :
      <ul className="mb-4 divide-y divide-border rounded-xl border border-border">{matches.map((m) => {
        const a = m.alert;
        const chosen = pick[a.key] ?? m.candidates[0]?.id;
        return <li key={a.key} className="p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p><span className="font-semibold tabular-nums text-ink">{inr(a.amount)}</span> received{a.payer ? ` from ${a.payer}` : ""}{a.vpa ? ` (${a.vpa})` : ""}{a.date ? ` on ${fmtDate(a.date)}` : ""}</p>
            <p className="text-xs text-muted-foreground">{a.utr ? `UPI ref ${a.utr}` : "No UPI reference"} · {a.source === "pasted" ? "pasted" : a.source === "sms" ? "bank SMS" : "bank email"}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {m.candidates.length === 0 ? <span className="text-xs text-muted-foreground">No unpaid invoice has a balance of {inr(a.amount)}. It may be an advance or a part payment: record it from the invoice.</span>
              : m.candidates.length === 1 ? <button type="button" className="btn-primary" disabled={busy} onClick={() => { void record(m, m.candidates[0].id); }}>
                  Record on {m.candidates[0].number} · {m.candidates[0].customer}</button>
              : <>
                  <select aria-label={`Invoice for ${inr(a.amount)}`} className="input h-9 w-auto" value={chosen} onChange={(e) => setPick({ ...pick, [a.key]: Number(e.target.value) })}>
                    {m.candidates.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.customer}</option>)}
                  </select>
                  <button type="button" className="btn-primary" disabled={busy || !chosen} onClick={() => { void record(m, chosen); }}>Record</button>
                  <span className="text-xs text-muted-foreground">{m.candidates.length} invoices have this balance: choose the right one.</span>
                </>}
            <button type="button" className="btn-ghost text-xs" onClick={() => { void dismiss(a.key); }}>Not an invoice payment</button>
          </div>
        </li>;
      })}</ul>}

    <h3 className="mb-1 text-sm font-semibold">Check a message</h3>
    <textarea aria-label="Bank SMS or email" className="input min-h-20" placeholder="Paste a bank SMS or email, e.g. “Rs.1,180.00 credited to A/c XX1234 by UPI Ref 412345678901”"
      value={paste} onChange={(e) => setPaste(e.target.value)} />
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      <button type="button" className="btn-primary" disabled={busy || !paste.trim()} onClick={() => { void run(paste); }}>Check this message</button>
    </div>
  </Modal>;
}
