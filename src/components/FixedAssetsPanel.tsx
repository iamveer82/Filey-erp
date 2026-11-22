import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, DataTable, ErrorBanner, Field, Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import { DateField } from "./DatePicker";
import { RowActions } from "./RowActions";
import { useUI } from "../lib/ui";
import { aed, errMsg, fmtDate, getDisplayCurrency, numInput, todayYmd } from "../lib/format";
import {
  ASSET_CATEGORIES, addFixedAsset, assetFigures, currentMonth, disposeFixedAsset, loadFixedAssets,
  postDepreciation, removeFixedAsset, type DepreciationMethod, type FixedAsset,
} from "../lib/fixedAssets";

type Row = FixedAsset & ReturnType<typeof assetFigures>;

/** Accounting → Fixed assets: what the business owns for the long run, what each item
 *  is still worth, and one button that puts the month's depreciation in the books. */
export default function FixedAssetsPanel({ onPosted }: { onPosted: () => void }) {
  const { confirm, toast } = useUI();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () =>
    loadFixedAssets()
      .then((list) => { setAssets(list); setError(""); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);

  const month = currentMonth();
  const rows = useMemo<Row[]>(() => assets.map((a) => ({ ...a, ...assetFigures(a, month) })), [assets, month]);
  const sum = (pick: (r: Row) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const due = sum((r) => r.due);

  // One action at a time; the list is re-read after each so the figures match the books.
  const act = async (work: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    try {
      const done = await work();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const post = () => act(async () => {
    if (!(await confirm({
      title: "Post depreciation?",
      message: `${aed(due)} goes into the journal: Depreciation up, Accumulated Depreciation up. This covers everything not yet posted, through this month.`,
      confirmLabel: "Post",
    }))) return;
    const run = await postDepreciation(month);
    onPosted();
    return `Posted ${aed(run.total)} for ${run.posted.length} asset${run.posted.length === 1 ? "" : "s"}.`;
  });

  const dispose = (a: FixedAsset) => act(async () => {
    if (!(await confirm({
      title: `Mark ${a.name} as sold or scrapped?`,
      message: "Depreciation stops from this month. Record the sale itself (the money received) as a journal entry.",
      confirmLabel: "Mark it",
    }))) return;
    await disposeFixedAsset(a.id, todayYmd());
    return `${a.name} is marked as disposed.`;
  });

  const remove = (a: FixedAsset) => act(async () => {
    if (!(await confirm({
      title: `Remove ${a.name}?`,
      message: "It comes off this list. Entries already posted to the journal stay there.",
      confirmLabel: "Remove",
      danger: true,
    }))) return;
    await removeFixedAsset(a.id);
    return `${a.name} removed.`;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {rows.length === 0
            ? "Vehicles, machines, computers: things you keep for years."
            : `Cost ${aed(sum((r) => r.cost))} · written off ${aed(sum((r) => r.accumulated))} · worth now ${aed(sum((r) => r.book_value))}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {due > 0 && (
            <button className="btn-primary" disabled={busy} onClick={post}>
              Post depreciation ({aed(due)})
            </button>
          )}
          <button className={due > 0 ? "btn-ghost" : "btn-primary"} disabled={busy} onClick={() => setAdding(true)}>
            <Plus size={16} /> Add asset
          </button>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <DataTable<Row>
        rowKey={(r) => r.id}
        pageSize={10}
        rows={rows}
        loading={loading}
        empty="No fixed assets yet"
        columns={[
          { summary: true, truncate: true, key: "name", label: "Asset", sortValue: (r) => r.name,
            render: (r) => (
              <span>
                <span className="font-medium text-ink">{r.name}</span>
                <span className="ml-2 text-xs text-muted">{r.category}</span>
              </span>
            ) },
          { key: "bought", label: "Bought", sortValue: (r) => r.purchase_date, render: (r) => fmtDate(r.purchase_date) },
          { key: "cost", label: "Cost", sortValue: (r) => r.cost, render: (r) => aed(r.cost) },
          { key: "month", label: "Per month", sortValue: (r) => r.this_month, render: (r) => (r.this_month ? aed(r.this_month) : "—") },
          { key: "off", label: "Written off", sortValue: (r) => r.accumulated, render: (r) => aed(r.accumulated) },
          { summary: true, key: "value", label: "Worth now", sortValue: (r) => r.book_value,
            render: (r) => <span className="font-medium">{aed(r.book_value)}</span> },
          { key: "status", label: "Status", sortValue: (r) => (r.disposed_on ? 2 : r.this_month ? 0 : 1),
            render: (r) =>
              r.disposed_on ? <Badge tone="neutral">Disposed</Badge>
              : r.due > 0 ? <Badge tone="warn">Not posted</Badge>
              : r.this_month ? <Badge tone="success">Up to date</Badge>
              : <Badge tone="neutral">Fully written off</Badge> },
          { actions: true, key: "actions", label: "Actions",
            render: (r) => (
              <span className="inline-flex items-center gap-1">
                {!r.disposed_on && (
                  <button className="btn-ghost text-xs" disabled={busy} onClick={() => dispose(r)}>Dispose</button>
                )}
                <RowActions onDelete={() => remove(r)} />
              </span>
            ) },
        ]}
      />

      <AddAssetModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onPosted(); void load(); }} />
    </div>
  );
}

const BLANK = { name: "", category: "Equipment", purchase_date: "", cost: 0, salvage: 0, years: 5, rate: 20, method: "straight_line" as DepreciationMethod, recordPurchase: false };

function AddAssetModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(BLANK);
  useEffect(() => { if (open) setF({ ...BLANK, purchase_date: todayYmd() }); }, [open]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const asset = await addFixedAsset({
        name: f.name, category: f.category, purchase_date: f.purchase_date, cost: f.cost, salvage: f.salvage,
        life_months: Math.round(f.years * 12), method: f.method, rate: f.rate,
      }, { recordPurchase: f.recordPurchase });
      toast.success(`${asset.name} added.`);
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Add fixed asset">
      <fieldset disabled={busy} className="space-y-3">
        <Field label="Name *">
          <input className="input" placeholder="e.g. Delivery van, Dubai plate 12345" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Kind">
            <SelectMenu ariaLabel="Kind" value={f.category} onChange={(category) => setF({ ...f, category })}
              options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Bought on">
            <DateField value={f.purchase_date} onChange={(purchase_date) => setF({ ...f, purchase_date })} clearable={false} />
          </Field>
          <Field label={`Cost (${getDisplayCurrency()}) *`}>
            <input type="number" className="input" placeholder="0" min="0.01" step="0.01" value={f.cost || ""}
              onChange={(e) => setF({ ...f, cost: numInput(e.target.value) })} />
          </Field>
          <Field label={`Worth at the end (${getDisplayCurrency()})`}>
            <input type="number" className="input" placeholder="0" min="0" step="0.01" value={f.salvage || ""}
              onChange={(e) => setF({ ...f, salvage: numInput(e.target.value) })} />
          </Field>
          <Field label="Write it off">
            <SelectMenu ariaLabel="Write it off" value={f.method} onChange={(method) => setF({ ...f, method: method as DepreciationMethod })}
              options={[
                { value: "straight_line", label: "Same amount every month" },
                { value: "declining_balance", label: "A percent of what is left" },
              ]} />
          </Field>
          {f.method === "straight_line" ? (
            <Field label="Lasts (years)">
              <input type="number" className="input" min="0.1" step="0.5" value={f.years || ""}
                onChange={(e) => setF({ ...f, years: numInput(e.target.value) })} />
            </Field>
          ) : (
            <Field label="Percent per year">
              <input type="number" className="input" min="1" max="100" step="1" value={f.rate || ""}
                onChange={(e) => setF({ ...f, rate: numInput(e.target.value) })} />
            </Field>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={f.recordPurchase} onChange={(e) => setF({ ...f, recordPurchase: e.target.checked })} />
          <span>
            Also record the purchase in the books, paid from Cash &amp; Bank
            <span className="block text-xs text-muted">Leave off if the purchase is already in your journal.</span>
          </span>
        </label>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 mt-5 border-t border-border pt-4">
        <button className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !f.name.trim() || !(f.cost > 0) || !f.purchase_date} onClick={save}>
          Add asset
        </button>
      </div>
    </Modal>
  );
}
