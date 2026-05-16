import { useEffect, useMemo, useState } from "react";
import { Plus, ClipboardList, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { erp, Order } from "../lib/api";
import { aed, fmtDate } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
} from "../components/ui";

const FLOW = ["draft", "confirmed", "delivered", "cancelled"];

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => erp.orders().then(setOrders).catch(console.error);
  useEffect(() => {
    load();
  }, []);

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
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New order
          </button>
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
          icon={<RotateCcw size={20} />}
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
    </div>
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
            value={f.total}
            onChange={(e) => setF({ ...f, total: +e.target.value })}
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
