import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Trash2,
  Pencil,
  PackageCheck,
  ClipboardList,
  Wallet,
  Truck,
  Download,
} from "lucide-react";
import {
  pos,
  suppliers as suppliersApi,
  erp,
  type PoSummary,
  type PoInput,
  type PoItem,
  type Supplier,
  type Product,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import { aed, fmtDate, num, numInput } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ErrorBanner,
} from "../components/ui";

const poNumber = () =>
  `PO-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 9000) + 1000
  )}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function PurchaseOrders() {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<PoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [params, setParams] = useSearchParams();

  const load = () => {
    setError("");
    return pos
      .list()
      .then(setRows)
      .catch((e) =>
        setError(
          `Could not load purchase orders: ${
            e instanceof Error ? e.message : e
          }`
        )
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);
  useEffect(() => {
    if (params.get("new") === "1") {
      setEditId("new");
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.status !== "received").length;
    const received = rows.filter((r) => r.status === "received").length;
    const value = rows.reduce((s, r) => s + r.total, 0);
    return { total: rows.length, open, received, value };
  }, [rows]);

  const receive = async (r: PoSummary) => {
    const ok = await confirm({
      title: "Receive stock",
      message: `Receive all items on ${r.po_number} into inventory? This increases product stock.`,
      confirmLabel: "Receive",
    });
    if (!ok) return;
    try {
      await pos.receive(r.id);
      load();
      toast.success("Stock received.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (r: PoSummary) => {
    const ok = await confirm({
      title: "Delete purchase order",
      message: `Delete ${r.po_number}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await pos.remove(r.id);
    load();
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Purchase Orders"
        subtitle="Order from suppliers, then receive stock into inventory"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              onClick={() =>
                downloadCsv(
                  "purchase-orders",
                  rows as unknown as Record<string, unknown>[],
                  [
                    { key: "po_number", label: "PO #" },
                    { key: "supplier_name", label: "Supplier" },
                    { key: "status", label: "Status" },
                    { key: "total", label: "Total" },
                    { key: "order_date", label: "Order date" },
                    { key: "expected_date", label: "Expected" },
                  ]
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button className="btn-primary" onClick={() => setEditId("new")}>
              <Plus size={16} /> New PO
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Purchase Orders"
          value={num(stats.total)}
          icon={<ClipboardList size={20} />}
        />
        <MetricCard
          label="Open"
          value={num(stats.open)}
          icon={<Truck size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Received"
          value={num(stats.received)}
          icon={<PackageCheck size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Total Value"
          value={aed(stats.value)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <DataTable<PoSummary>
        rows={rows}
        loading={loading}
        empty="No purchase orders yet — create your first one"
        columns={[
          {
            key: "no",
            label: "PO #",
            render: (r) => (
              <span className="font-mono text-xs font-semibold">
                {r.po_number}
              </span>
            ),
          },
          {
            key: "sup",
            label: "Supplier",
            render: (r) => (
              <span className="font-semibold text-ink">
                {r.supplier_name}
              </span>
            ),
          },
          {
            key: "total",
            label: "Total",
            render: (r) => aed(r.total),
          },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            ),
          },
          {
            key: "exp",
            label: "Expected",
            render: (r) => (r.expected_date ? fmtDate(r.expected_date) : "—"),
          },
          {
            key: "act",
            label: "",
            render: (r) => (
              <div className="flex items-center gap-1">
                {r.status !== "received" && (
                  <button
                    aria-label="Receive stock"
                    title="Receive into inventory"
                    className="text-success hover:bg-success/10 rounded-lg p-1.5 cursor-pointer"
                    onClick={() => receive(r)}
                  >
                    <PackageCheck size={15} />
                  </button>
                )}
                <button
                  aria-label="Edit"
                  className="text-brand-600 hover:bg-brand-100 dark:hover:bg-white/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => setEditId(r.id)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label="Delete"
                  className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => del(r)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />

      {editId !== null && (
        <POEditor
          id={editId}
          onClose={() => setEditId(null)}
          onSaved={() => {
            setEditId(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function POEditor({
  id,
  onClose,
  onSaved,
}: {
  id: number | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [orderDate, setOrderDate] = useState(today());
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PoItem[]>([
    { description: "", quantity: 1, unit_cost: 0 },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    suppliersApi.list().then(setSuppliers).catch(() => {});
    erp.products().then(setProducts).catch(() => {});
    if (id !== "new") {
      pos
        .get(id)
        .then((po) => {
          if (!po) return;
          setSupplierId(po.supplier_id ? String(po.supplier_id) : "");
          setOrderDate(po.order_date ?? today());
          setExpected(po.expected_date ?? "");
          setNotes(po.notes ?? "");
          setLines(
            po.items.length
              ? po.items
              : [{ description: "", quantity: 1, unit_cost: 0 }]
          );
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
  const setLine = (i: number, patch: Partial<PoItem>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { description: "", quantity: 1, unit_cost: 0 }]);
  const delLine = (i: number) =>
    setLines((ls) => ls.filter((_, x) => x !== i));

  const pickProduct = (i: number, pid: string) => {
    const p = products.find((x) => String(x.id) === pid);
    setLine(i, {
      product_id: p ? p.id : undefined,
      description: p ? p.name : lines[i].description,
      unit_cost: p ? p.cost_price : lines[i].unit_cost,
    });
  };

  const valid =
    !!supplierId && lines.some((l) => l.description.trim() && l.quantity > 0);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const input: PoInput = {
        id: id === "new" ? undefined : id,
        po_number: id === "new" ? poNumber() : "",
        supplier_id: supplierId ? Number(supplierId) : undefined,
        status: "draft",
        total,
        order_date: orderDate,
        expected_date: expected || undefined,
        notes: notes || undefined,
        items: lines.filter((l) => l.description.trim()),
      };
      // Keep an existing PO's number: only set on create.
      if (id !== "new") delete (input as { po_number?: string }).po_number;
      await pos.save(input);
      toast.success("Purchase order saved.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={id === "new" ? "New Purchase Order" : "Edit Purchase Order"}
      size="2xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Field label="Supplier *">
          <select
            className="select"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Select supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order date">
          <input
            type="date"
            className="input"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </Field>
        <Field label="Expected date">
          <input
            type="date"
            className="input"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-xl border border-brand-200 dark:border-[#3A3D45] overflow-hidden mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-brand-400 bg-brand-50/60 dark:bg-white/5">
              <th className="px-3 py-2">Product / description</th>
              <th className="px-3 py-2 w-24">Qty</th>
              <th className="px-3 py-2 w-32">Unit cost</th>
              <th className="px-3 py-2 w-28 text-right">Amount</th>
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-brand-100 dark:border-[#2A2C33]">
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {products.length > 0 && (
                      <select
                        className="select !h-8 text-xs"
                        value={l.product_id ? String(l.product_id) : ""}
                        onChange={(e) => pickProduct(i, e.target.value)}
                      >
                        <option value="">Custom / pick product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      className="input !h-8"
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) =>
                        setLine(i, { description: e.target.value })
                      }
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="input !h-8 tabular-nums"
                    value={l.quantity || ""}
                    onChange={(e) =>
                      setLine(i, { quantity: numInput(e.target.value) })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="input !h-8 tabular-nums"
                    value={l.unit_cost || ""}
                    onChange={(e) =>
                      setLine(i, { unit_cost: numInput(e.target.value) })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {aed(l.quantity * l.unit_cost)}
                </td>
                <td className="px-3 py-2">
                  {lines.length > 1 && (
                    <button
                      aria-label="Remove line"
                      className="text-danger hover:bg-danger/10 rounded-lg p-1 cursor-pointer"
                      onClick={() => delLine(i)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button className="btn-ghost text-xs" onClick={addLine}>
          <Plus size={14} /> Add line
        </button>
        <div className="text-right">
          <span className="text-xs text-brand-400 mr-2">Total</span>
          <span className="font-display text-lg font-bold text-ink tabular-nums">
            {aed(total)}
          </span>
        </div>
      </div>

      <Field label="Notes">
        <textarea
          className="textarea"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!valid || busy} onClick={save}>
          {busy ? "Saving…" : "Save PO"}
        </button>
      </div>
    </Modal>
  );
}
