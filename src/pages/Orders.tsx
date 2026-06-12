import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  ClipboardList,
  CheckCircle2,
  Clock,
  Wallet,
  ShoppingCart,
  Pencil,
  Trash2,
  Search,
  X,
} from "lucide-react";
import { erp, Order, Product } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, fmtDate, numInput, cn, getDisplayCurrency } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
  ErrorBanner,
} from "../components/ui";
import ProductPicker, { type CartLine } from "../components/ProductPicker";

const FLOW = ["draft", "confirmed", "delivered", "cancelled"];

/** Next sequential order number for this year, derived from existing
 *  orders — random suffixes collide and confuse customers. */
const nextOrderNumber = (existing: Order[]) => {
  const y = new Date().getFullYear();
  const max = existing.reduce((m, o) => {
    const match = /^SO-(\d{4})-(\d+)$/.exec(o.order_number ?? "");
    return match && Number(match[1]) === y
      ? Math.max(m, parseInt(match[2], 10))
      : m;
  }, 0);
  return `SO-${y}-${String(max + 1).padStart(4, "0")}`;
};

export default function Orders() {
  const { toast, confirm } = useUI();
  const [orders, setOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") {
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const load = () => {
    setError("");
    return Promise.all([
      erp.orders().then(setOrders),
      erp.products().then(setProducts),
    ])
      .catch((e) =>
        setError(`Could not load orders: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const stats = useMemo(() => {
    const by = (s: string[]) =>
      orders.filter((o) => s.includes(o.status.toLowerCase()));
    return {
      completed: by(["delivered", "paid", "completed"]).length,
      progress: by(["confirmed", "draft", "processing"]).length,
      returns: by(["returned", "cancelled"]).length,
      value: orders.reduce((s, o) => s + o.total, 0),
    };
  }, [orders]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Orders"
        subtitle="Sales orders & fulfilment status"
        action={
          <div className="flex gap-2">
            <button className="btn-ghost" aria-label="Quick order" onClick={() => setOpen(true)}>
              <Plus size={16} /> Quick order
            </button>
            <button
              className="btn-primary"
              aria-label="Build order"
              onClick={() => setBuildOpen(true)}
            >
              <ShoppingCart size={16} /> Build order
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
          label="Total Orders"
          value={String(orders.length)}
          icon={<ClipboardList size={20} />}
        />
        <MetricCard
          label="Completed"
          value={String(stats.completed)}
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="In Progress"
          value={String(stats.progress)}
          icon={<Clock size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Order Value"
          value={aed(stats.value)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <DataTable<Order>
        rows={orders}
        loading={loading}
        empty="No orders yet"
        columns={[
          {
            key: "no",
            label: "Order #",
            sortValue: (o) => o.order_number,
            render: (o) => (
              <span className="font-mono text-xs text-brand-500">
                {o.order_number}
              </span>
            ),
          },
          {
            key: "cust",
            label: "Customer",
            sortValue: (o) => o.customer_name,
            render: (o) => (
              <span className="font-semibold text-ink">
                {o.customer_name}
              </span>
            ),
          },
          { key: "total", label: "Total", sortValue: (o) => o.total, render: (o) => aed(o.total) },
          {
            key: "status",
            label: "Status",
            sortValue: (o) => o.status,
            render: (o) => (
              <Badge tone={statusTone(o.status)}>{o.status}</Badge>
            ),
          },
          {
            key: "date",
            label: "Created",
            sortValue: (o) => o.created_at,
            render: (o) => fmtDate(o.created_at),
          },
          {
            key: "share",
            label: "Sharing",
            render: (o) => (
              <ShareToggle
                shared={o.shared}
                onToggle={async (next) => {
                  try {
                    await erp.shareOrder(o.id, next);
                    load();
                    toast.success(
                      next ? "Shared with team." : "Set to private."
                    );
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            ),
          },
          {
            key: "act",
            label: "",
            render: (o) => {
              const idx = FLOW.indexOf(o.status.toLowerCase());
              // No forward transition from "cancelled" or unknown statuses —
              // wrapping back to "draft" silently regressed orders.
              const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
              return (
                <div className="flex items-center gap-1">
                  {next && (
                  <button
                    className="btn-ghost text-xs"
                    onClick={async () => {
                      try {
                        await erp.setOrderStatus(o.id, next);
                        load();
                      } catch (e: any) {
                        toast.error(e?.message || "Failed to update order status");
                      }
                    }}
                  >
                    → {next}
                  </button>
                  )}
                  <button
                    aria-label="Edit order"
                    className="text-brand-600 hover:bg-brand-100 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                    onClick={() => setEditId(o.id)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label="Delete order"
                    className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Delete order",
                        message: `Delete ${o.order_number}? Any stock it reserved is returned. This cannot be undone.`,
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await erp.deleteOrder(o.id);
                        load();
                        toast.success(`Deleted ${o.order_number}`);
                      } catch (e: any) {
                        toast.error(e?.message || "Failed to delete order");
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            },
          },
        ]}
      />

      <OrderModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
        suggestedNumber={nextOrderNumber(orders)}
      />

      <BuildOrderModal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        products={products}
        suggestedNumber={nextOrderNumber(orders)}
        onSaved={() => {
          setBuildOpen(false);
          load();
        }}
      />

      <EditOrderModal
        orderId={editId}
        products={products}
        onClose={() => setEditId(null)}
        onSaved={() => {
          setEditId(null);
          load();
        }}
      />
    </div>
  );
}

type EditLine = {
  product_id: number | null;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
};

function EditOrderModal({
  orderId,
  products,
  onClose,
  onSaved,
}: {
  orderId: number | null;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState("draft");
  const [manualTotal, setManualTotal] = useState(0);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (orderId == null) return;
    setLoading(true);
    setErr(null);
    setPickOpen(false);
    setQ("");
    erp
      .getOrder(orderId)
      .then((o) => {
        setCustomer(o.customer_name ?? "");
        setStatus(o.status ?? "draft");
        setManualTotal(o.total ?? 0);
        setLines(
          (o.items ?? []).map((it) => {
            const p = products.find((x) => x.id === it.product_id);
            return {
              product_id: it.product_id ?? null,
              name: p?.name ?? (it.product_id ? `#${it.product_id}` : "Item"),
              sku: p?.sku ?? "",
              quantity: it.quantity,
              unit_price: it.unit_price,
            };
          })
        );
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [orderId, products]);

  const linesTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const effectiveTotal = lines.length ? linesTotal : manualTotal;

  const setLine = (i: number, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const delLine = (i: number) =>
    setLines((ls) => ls.filter((_, x) => x !== i));
  const addProduct = (p: Product) => {
    setLines((ls) => {
      const ex = ls.findIndex((l) => l.product_id === p.id);
      if (ex >= 0)
        return ls.map((l, x) =>
          x === ex ? { ...l, quantity: l.quantity + 1 } : l
        );
      return [
        ...ls,
        {
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          quantity: 1,
          unit_price: p.unit_price,
        },
      ];
    });
    setPickOpen(false);
    setQ("");
  };

  const save = async () => {
    if (orderId == null) return;
    if (!customer.trim()) {
      setErr("Customer name is required.");
      return;
    }
    // Only line items mapped to a real product affect stock; keep all lines'
    // money in the total but send product-linked rows for the items table.
    const productLines = lines
      .filter((l) => l.product_id != null && l.quantity > 0)
      .map((l) => ({
        product_id: l.product_id as number,
        quantity: l.quantity,
        unit_price: l.unit_price,
      }));
    setBusy(true);
    setErr(null);
    try {
      await erp.updateOrder(
        orderId,
        { customer_name: customer.trim(), status, total: effectiveTotal },
        productLines
      );
      toast.success("Order updated.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <Modal
      open={orderId != null}
      onClose={onClose}
      title="Edit order"
      size="2xl"
    >
      {loading ? (
        <p className="py-10 text-center text-sm text-brand-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer *">
              <input
                className={cn("input", !customer.trim() && "border-danger")}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </Field>
            <Field label="Status">
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {FLOW.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-ink">Line items</p>
              <button
                className="btn-ghost text-xs"
                onClick={() => setPickOpen((v) => !v)}
              >
                <Plus size={13} /> Add product
              </button>
            </div>

            {pickOpen && (
              <div className="mb-3 rounded-xl border border-brand-200 p-2 dark:border-[#3A3D45]">
                <div className="relative mb-2">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-400"
                  />
                  <input
                    autoFocus
                    className="input pl-9"
                    placeholder="Search products…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink truncate">
                          {p.name}
                        </span>
                        <span className="block text-[11px] text-brand-400 font-mono">
                          {p.sku} · {p.quantity} in stock
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-ink">
                        {aed(p.unit_price)}
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-sm text-brand-400 text-center py-4">
                      No products found.
                    </p>
                  )}
                </div>
              </div>
            )}

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-brand-200 dark:border-[#3A3D45] p-4">
                <p className="text-xs text-brand-400 mb-2">
                  This order has no line items. Add products above, or set a
                  total manually.
                </p>
                <Field label={`Total (${getDisplayCurrency()})`}>
                  <input
                    type="number"
                    className="input"
                    value={manualTotal || ""}
                    placeholder="0"
                    onChange={(e) => setManualTotal(numInput(e.target.value))}
                  />
                </Field>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-brand-400">
                      <th className="py-1.5 px-2">Product</th>
                      <th className="py-1.5 px-2 w-20 text-right">Qty</th>
                      <th className="py-1.5 px-2 w-28 text-right">Price</th>
                      <th className="py-1.5 px-2 w-28 text-right">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t border-brand-100 dark:border-white/10">
                        <td className="py-1.5 px-2">
                          <span className="font-semibold text-ink">{l.name}</span>
                          {l.sku && (
                            <span className="block text-[11px] text-brand-400 font-mono">
                              {l.sku}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            className="input text-right !px-2"
                            value={l.quantity || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setLine(i, { quantity: numInput(e.target.value) })
                            }
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number"
                            className="input text-right !px-2"
                            value={l.unit_price || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setLine(i, {
                                unit_price: numInput(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold text-ink">
                          {aed(l.quantity * l.unit_price)}
                        </td>
                        <td className="py-1.5">
                          <button
                            aria-label="Remove line"
                            className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                            onClick={() => delLine(i)}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {err && (
            <p className="text-xs font-semibold text-danger bg-danger/10 rounded-xl px-3 py-2">
              {err}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-brand-100 dark:border-white/10 pt-3">
            <span className="text-sm font-semibold text-brand-500">Total</span>
            <span className="text-base font-bold text-ink tabular-nums">
              {aed(effectiveTotal)}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy || !customer.trim()}
              onClick={save}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BuildOrderModal({
  open,
  onClose,
  products,
  onSaved,
  suggestedNumber,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onSaved: () => void;
  suggestedNumber: string;
}) {
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCustomer("");
      setErr(null);
    }
  }, [open]);

  const checkout = async (lines: CartLine[], total: number) => {
    if (!customer.trim()) {
      setErr("Enter a customer name first.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await erp.createOrderWithItems(
        suggestedNumber,
        customer.trim(),
        lines.map((l) => ({
          product_id: l.id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        total
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Build sales order" size="2xl">
      <div className="mb-4">
        <Field label="Customer">
          <input
            className="input"
            placeholder="e.g. Acme Corp"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </Field>
        {err && (
          <p className="text-xs font-semibold text-danger bg-danger/10 rounded-xl px-3 py-2 mt-2">
            {err}
          </p>
        )}
      </div>
      <ProductPicker
        products={products}
        onCheckout={checkout}
        busy={busy}
      />
    </Modal>
  );
}

function OrderModal({
  open,
  onClose,
  onSaved,
  suggestedNumber,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  suggestedNumber: string;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    order_number: "",
    customer_name: "",
    total: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setF({ order_number: "", customer_name: "", total: 0 });
      setSaving(false);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New Sales Order">
      <div className="space-y-3">
        <Field label="Order Number">
          <input
            className="input"
            value={f.order_number}
            onChange={(e) => setF({ ...f, order_number: e.target.value })}
            placeholder={suggestedNumber}
          />
        </Field>
        <Field label="Customer Name *">
          <input
            className={cn("input", !f.customer_name.trim() && "border-danger")}
            value={f.customer_name}
            onChange={(e) => setF({ ...f, customer_name: e.target.value })}
          />
          {!f.customer_name.trim() && (
            <p className="text-[11px] text-danger mt-1">
              Customer name is required.
            </p>
          )}
        </Field>
        <Field label={`Total (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.total || ""}
            onChange={(e) => setF({ ...f, total: numInput(e.target.value) })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!f.customer_name.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await erp.createOrder(
                f.order_number.trim() || suggestedNumber,
                f.customer_name,
                f.total
              );
              toast.success("Order created.");
              onSaved();
              onClose();
            } catch (e: any) {
              toast.error(e?.message || "Failed to create order");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save Order"}
        </button>
      </div>
    </Modal>
  );
}
