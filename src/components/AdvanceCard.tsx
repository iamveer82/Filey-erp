import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, Plus, Trash2 } from "lucide-react";
import { advances, crm, type Advance, type CrmCustomer } from "../lib/api";
import { aed, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";
import { Modal, Field } from "./ui";

/** Per-party advance/prepayment card. Shows the credit balance, lets the user
 *  record or remove advances, and (when `outstanding` is given) the net still
 *  due after the advance is applied. Used on customer + supplier detail pages. */
export default function AdvanceCard({
  partyType,
  partyId,
  partyName,
  outstanding,
}: {
  partyType: "customer" | "supplier";
  partyId: number;
  partyName: string;
  /** Gross amount owed; when provided a "net after advance" line is shown. */
  outstanding?: number;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<Advance[]>([]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const load = () =>
    advances.forParty(partyType, partyId).then(setRows).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType, partyId]);

  const total = rows.reduce((s, a) => s + Number(a.amount), 0);
  const net = outstanding != null ? Math.max(0, outstanding - total) : undefined;
  const label = partyType === "customer" ? "Advance received" : "Advance paid";

  const add = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    setSaving(true);
    try {
      await advances.add({
        party_type: partyType,
        party_id: partyId,
        party_name: partyName,
        amount: amt,
        note: note || undefined,
        paid_at: date,
      });
      setAmount("");
      setNote("");
      setOpen(false);
      toast.success("Advance recorded.");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to record advance.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Advance) => {
    const ok = await confirm({
      title: "Remove advance",
      message: `Remove the ${aed(a.amount)} advance? This cannot be undone.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await advances.remove(a.id);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove.");
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-brand-400" />
          <h2 className="text-sm font-medium text-ink">{label}</h2>
        </div>
        <button
          className="btn-ghost text-xs !py-1 !px-2.5"
          onClick={() => setOpen(true)}
        >
          <Plus size={13} /> Add
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-ink">{aed(total)}</span>
        <span className="text-xs text-brand-400">
          credit balance
          {rows.length
            ? ` · ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
            : ""}
        </span>
      </div>
      {net != null && (
        <p className="text-xs text-brand-500 mt-1">
          Net {partyType === "customer" ? "due from customer" : "payable"}:{" "}
          <span className="font-medium text-ink">{aed(net)}</span>
          {total > 0 && <span className="text-brand-400"> (after advance)</span>}
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="divide-y divide-brand-100 border-t border-brand-100 mt-3">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-ink">{aed(a.amount)}</span>
                <span className="text-brand-400"> · {fmtDate(a.paid_at)}</span>
                {a.note && (
                  <span className="text-brand-500"> — {a.note}</span>
                )}
              </div>
              <button
                className="text-brand-400 hover:text-danger p-1 rounded cursor-pointer shrink-0"
                onClick={() => remove(a)}
                aria-label="Remove advance"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-brand-400 mt-3">No advances recorded yet.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <div className="space-y-3">
          <Field label="Amount (AED)">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </Field>
          <Field label="Date">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Note (optional)">
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. bank transfer, cheque #…"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={saving} onClick={add}>
              {saving ? "Saving…" : "Save advance"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Invoicing-dashboard widget: record customer advances and see every customer
 *  holding credit (net of amounts already applied to invoices), summed + ranked. */
export function CustomerAdvancesPanel() {
  const { toast } = useUI();
  const [rows, setRows] = useState<Advance[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [custId, setCustId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const load = () =>
    advances
      .list()
      .then((all) => setRows(all.filter((a) => a.party_type === "customer")))
      .catch(() => {});
  useEffect(() => {
    load();
    crm.customers().then(setCustomers).catch(() => {});
  }, []);

  const byParty = new Map<number, { name: string; total: number }>();
  for (const a of rows) {
    const cur = byParty.get(a.party_id) || { name: a.party_name, total: 0 };
    cur.total += Number(a.amount);
    byParty.set(a.party_id, cur);
  }
  const list = [...byParty.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .filter((p) => p.total > 0.005)
    .sort((x, y) => y.total - x.total);
  const total = list.reduce((s, p) => s + p.total, 0);

  const add = async () => {
    const c = customers.find((x) => String(x.id) === custId);
    const amt = parseFloat(amount);
    if (!c) {
      toast.error("Pick a customer.");
      return;
    }
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    setSaving(true);
    try {
      await advances.add({
        party_type: "customer",
        party_id: c.id,
        party_name: c.company || c.name,
        amount: amt,
        note: note || undefined,
        paid_at: date,
      });
      setCustId("");
      setAmount("");
      setNote("");
      setOpen(false);
      toast.success("Advance recorded.");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to record advance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-brand-400" />
          <h2 className="text-sm font-medium text-ink">Customer advances</h2>
          {total > 0 && (
            <span className="text-sm font-semibold text-ink">· {aed(total)}</span>
          )}
        </div>
        <button
          className="btn-ghost text-xs !py-1 !px-2.5"
          onClick={() => setOpen(true)}
        >
          <Plus size={13} /> Add advance
        </button>
      </div>
      {list.length > 0 ? (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-brand-100 px-3 py-2 text-sm"
            >
              <Link
                to={`/customers/${p.id}`}
                className="truncate text-brand-700 hover:text-ink"
              >
                {p.name}
              </Link>
              <span className="font-medium text-ink shrink-0 ml-2">{aed(p.total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-brand-400">
          No advances on file. Record one when a customer pays up front — it's
          subtracted on their next invoice.
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Record customer advance">
        <div className="space-y-3">
          <Field label="Customer">
            <select
              className="select"
              value={custId}
              onChange={(e) => setCustId(e.target.value)}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (AED)">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Date">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Note (optional)">
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. bank transfer, cheque #…"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={saving} onClick={add}>
              {saving ? "Saving…" : "Save advance"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
