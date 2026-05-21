import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  ClipboardList,
  CheckCircle2,
  Clock,
  Wallet,
  ShoppingCart,
} from "lucide-react";
import { erp, Order, Product } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, fmtDate, numInput } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
} from "../components/ui";
import ProductPicker, { type CartLine } from "../components/ProductPicker";

const FLOW = ["draft", "confirmed", "delivered", "cancelled"];

const nextOrderNumber = () => {
  const y = new Date().getFullYear();
  return `SO-${y}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
};

export default function Orders() {
  const { toast } = useUI();
  const [orders, setOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const load = () => {
    erp.orders().then(setOrders).catch(console.error);
    erp.products().then(setProducts).catch(console.error);
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
            <button className="btn-ghost" onClick={() => setOpen(true)}>
              <Plus size={16} /> Quick order
            </button>
            <button
              className="btn-primary"
              onClick={() => setBuildOpen(true)}
            >
              <ShoppingCart size={16} /> Build order
            </button>
          </div>
        }
      />

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
        empty="No orders yet"
        columns={[
          {
            key: "no",
            label: "Order #",
            render: (o) => (
              <span className="font-mono text-xs text-brand-500">
                {o.order_number}
              </span>
            ),
          },
          {
            key: "cust",
            label: "Customer",
            render: (o) => (
              <span className="font-semibold text-ink">
                {o.customer_name}
              </span>
            ),
          },
          { key: "total", label: "Total", render: (o) => aed(o.total) },
          {
            key: "status",
            label: "Status",
            render: (o) => (
              <Badge tone={statusTone(o.status)}>{o.status}</Badge>
            ),
          },
          {
            key: "date",
            label: "Created",
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
              const next =
                FLOW[(FLOW.indexOf(o.status.toLowerCase()) + 1) % FLOW.length];
              return (
                <button
                  className="btn-ghost text-xs"
                  onClick={async () => {
                    await erp.setOrderStatus(o.id, next);
                    load();
                  }}
                >
                  → {next}
                </button>
              );
            },
          },
        ]}
      />

      <OrderModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
      />

      <BuildOrderModal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        products={products}
        onSaved={() => {
          setBuildOpen(false);
          load();
        }}
      />
    </div>
  );
}

function BuildOrderModal({
  open,
  onClose,
  products,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onSaved: () => void;
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
        nextOrderNumber(),
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
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    order_number: "",
    customer_name: "",
    total: 0,
  });
  return (
    <Modal open={open} onClose={onClose} title="New Sales Order">
      <div className="space-y-3">
        <Field label="Order Number">
          <input
            className="input"
            value={f.order_number}
            onChange={(e) => setF({ ...f, order_number: e.target.value })}
            placeholder="SO-2026-0004"
          />
        </Field>
        <Field label="Customer Name">
          <input
            className="input"
            value={f.customer_name}
            onChange={(e) => setF({ ...f, customer_name: e.target.value })}
          />
        </Field>
        <Field label="Total (AED)">
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
          onClick={async () => {
            await erp.createOrder(f.order_number, f.customer_name, f.total);
            onSaved();
            onClose();
          }}
        >
          Save Order
        </button>
      </div>
    </Modal>
  );
}
