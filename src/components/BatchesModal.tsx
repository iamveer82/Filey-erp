import { useState } from "react";
import type { Product } from "../lib/api";
import { fmtDate, getDisplayCurrency, money, numInput, todayYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import { Badge, Modal } from "./ui";
import { batchStock, expiryFrom, readBatches, receiveBatch, writeOffBatch } from "../lib/batches";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Receive a batch (number, expiry, quantity, MRP), see what is left of each, and write off expired stock. */
export default function BatchesModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useUI();
  const [form, setForm] = useState({ no: "", exp: "", qty: 0, mrp: 0 });
  const [busy, setBusy] = useState(false);
  if (!product) return null;
  const today = todayYmd();
  const { batches, unbatched } = batchStock(readBatches(product), Number(product.quantity) || 0, today);
  const exp = expiryFrom(form.exp);
  const can = !!form.no.trim() && !!exp && form.qty > 0 && !busy;

  const receive = async () => {
    if (!can) return;
    setBusy(true);
    try {
      await receiveBatch(product, { no: form.no.trim(), exp, qty: form.qty, ...(form.mrp > 0 ? { mrp: form.mrp } : {}) }, today);
      toast.success(`Batch ${form.no.trim()} received: ${form.qty} added to stock.`);
      setForm({ no: "", exp: "", qty: 0, mrp: 0 });
      onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const writeOff = async (no: string, left: number) => {
    if (!(await confirm({ title: `Write off batch ${no}?`, message: `${left} expired unit${left === 1 ? "" : "s"} come off stock.`, confirmLabel: "Write off", danger: true }))) return;
    setBusy(true);
    try { await writeOffBatch(product, no, today); toast.success(`Batch ${no} written off.`); onSaved(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return <Modal open onClose={onClose} title={`Batches - ${product.name}`} size="2xl">
    <p className="mb-3 text-xs text-muted-foreground">Sales take the batch that expires first. What is left of each batch follows the stock on hand, however it went down.</p>
    {batches.length === 0 ? <p className="mb-4 rounded-xl border border-border p-3 text-sm text-muted-foreground">No batches yet. Receive one below.</p> :
      <div className="mb-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Batch</th><th className="px-3 py-2 font-medium">Expiry</th>
            <th className="px-3 py-2 text-right font-medium">Left</th><th className="px-3 py-2 text-right font-medium">MRP</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>{batches.map((b) => <tr key={`${b.no}-${b.exp}`} className="border-b border-border last:border-0">
            <td className="px-3 py-2 font-medium text-ink">{b.no}</td>
            <td className="px-3 py-2">{fmtDate(b.exp)} {b.expired ? <Badge tone="danger">Expired</Badge> : b.daysLeft <= 90 ? <Badge tone="warn">{b.daysLeft} days</Badge> : null}</td>
            <td className="px-3 py-2 text-right tabular-nums">{b.left}</td>
            <td className="px-3 py-2 text-right tabular-nums">{b.mrp ? money(b.mrp, getDisplayCurrency()) : "—"}</td>
            <td className="px-3 py-2 text-right">{b.expired && b.left > 0 && <button type="button" className="btn-ghost text-xs text-danger" disabled={busy} onClick={() => { void writeOff(b.no, b.left); }}>Write off</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {unbatched > 0 && <p className="mb-4 text-xs text-muted-foreground">{unbatched} in stock without a batch (received before batches were kept).</p>}
    <h3 className="mb-2 text-sm font-semibold">Receive a batch</h3>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="text-xs">Batch no.<input aria-label="Batch number" className="input mt-1" value={form.no} onChange={(e) => setForm({ ...form, no: e.target.value.toUpperCase() })} /></label>
      <label className="text-xs">Expiry<input aria-label="Expiry" className="input mt-1" placeholder="MM/YY or date" value={form.exp} onChange={(e) => setForm({ ...form, exp: e.target.value })} />
        {form.exp && !exp && <span className="text-[11px] text-danger">Use MM/YY or YYYY-MM-DD</span>}</label>
      <label className="text-xs">Quantity<input aria-label="Quantity received" type="number" min="0" className="input mt-1" value={form.qty || ""} onChange={(e) => setForm({ ...form, qty: numInput(e.target.value) })} /></label>
      <label className="text-xs">MRP (optional)<input aria-label="MRP" type="number" min="0" className="input mt-1" value={form.mrp || ""} onChange={(e) => setForm({ ...form, mrp: numInput(e.target.value) })} /></label>
    </div>
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      <button type="button" className="btn-primary" disabled={!can} onClick={() => { void receive(); }}>{busy ? "Saving…" : "Receive batch"}</button>
    </div>
  </Modal>;
}
