import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Users,
  Boxes,
  AlertTriangle,
  Package,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  erp,
  suppliers as suppliersApi,
  shareRecord,
  Product,
  Supplier,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, num } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  Card,
  Badge,
  DataTable,
  Modal,
  Field,
  ShareToggle,
  ErrorBanner,
} from "../components/ui";

interface CategoryGroup {
  name: string;
  skus: number;
  value: number;
  low: number;
}

export default function Suppliers() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [edit, setEdit] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { confirm, toast } = useUI();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") {
      setEdit(null);
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const load = () => {
    setError("");
    return Promise.all([
      erp.products().then(setProducts),
      suppliersApi.list().then(setSuppliers),
    ])
      .catch((e) =>
        setError(`Could not load suppliers: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const groups = useMemo<CategoryGroup[]>(() => {
    const m = new Map<string, CategoryGroup>();
    for (const p of products) {
      const key = p.category || "Unsorted";
      const g =
        m.get(key) ?? { name: key, skus: 0, value: 0, low: 0 };
      g.skus += 1;
      g.value += p.quantity * p.cost_price;
      if (p.quantity <= p.reorder_level) g.low += 1;
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value);
  }, [products]);

  const totalValue = groups.reduce((s, g) => s + g.value, 0);
  const totalLow = groups.reduce((s, g) => s + g.low, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Suppliers"
        subtitle="Vendor records & sourcing performance"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> New Supplier
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Suppliers"
          value={num(suppliers.length)}
          icon={<Users size={20} />}
        />
        <MetricCard
          label="Sourced SKUs"
          value={num(products.length)}
          icon={<Boxes size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Sourcing Value"
          value={aed(totalValue)}
          icon={<Package size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="At Reorder"
          value={num(totalLow)}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
      </div>

      <DataTable<Supplier>
        rows={suppliers}
        loading={loading}
        empty="No suppliers yet — add your first one"
        columns={[
          {
            key: "name",
            label: "Supplier",
            render: (s) => (
              <span className="font-semibold text-ink">{s.name}</span>
            ),
          },
          {
            key: "contact",
            label: "Contact",
            render: (s) => s.contact_person ?? "—",
          },
          {
            key: "email",
            label: "Email",
            render: (s) => s.email ?? "—",
          },
          {
            key: "phone",
            label: "Phone",
            render: (s) => s.phone ?? "—",
          },
          {
            key: "share",
            label: "Sharing",
            render: (s) => (
              <ShareToggle
                shared={s.shared}
                onToggle={async (next) => {
                  try {
                    await shareRecord("suppliers", s.id, next);
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
            render: (s) => (
              <div className="flex gap-1">
                <button
                  aria-label="Edit"
                  className="text-brand-600 hover:bg-brand-100 dark:hover:bg-white/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={() => {
                    setEdit(s);
                    setOpen(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label="Delete"
                  className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete supplier",
                      message: `Delete supplier "${s.name}"?`,
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    await suppliersApi.remove(s.id);
                    load();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          },
        ]}
      />

      <p className="mt-8 mb-3 text-xs font-bold uppercase tracking-wider text-brand-400">
        By product category
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.name} hover className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="rounded-2xl bg-primary-100 text-primary-700 p-3">
                <Package size={22} />
              </div>
              {g.low > 0 ? (
                <Badge tone="warn">{g.low} low</Badge>
              ) : (
                <Badge tone="success">healthy</Badge>
              )}
            </div>
            <div>
              <p className="text-lg font-bold text-ink">{g.name}</p>
              <p className="text-sm text-brand-500 mt-0.5">
                {g.skus} SKU{g.skus === 1 ? "" : "s"} sourced
              </p>
            </div>
            <div className="mt-auto pt-3 border-t border-brand-100 dark:border-[#2A261E] flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-400">
                Sourcing value
              </span>
              <span className="text-sm font-bold text-ink">
                {aed(g.value)}
              </span>
            </div>
          </Card>
        ))}
        {groups.length === 0 && (
          <Card className="col-span-full text-center text-sm text-brand-400">
            No supplier groups yet — add products with categories to see
            sourcing performance.
          </Card>
        )}
      </div>

      <SupplierModal
        open={open}
        initial={edit}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function SupplierModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    address: "",
    tax_id: "",
    notes: "",
  });
  useEffect(() => {
    if (open) {
      setF({
        name: initial?.name ?? "",
        contact_person: initial?.contact_person ?? "",
        email: initial?.email ?? "",
        phone: initial?.phone ?? "",
        address: initial?.address ?? "",
        tax_id: initial?.tax_id ?? "",
        notes: initial?.notes ?? "",
      });
    }
  }, [open, initial]);

  const save = async () => {
    if (!f.name.trim()) {
      toast.error("Supplier name is required.");
      return;
    }
    const payload = {
      name: f.name.trim(),
      contact_person: f.contact_person || undefined,
      email: f.email || undefined,
      phone: f.phone || undefined,
      address: f.address || undefined,
      tax_id: f.tax_id || undefined,
      notes: f.notes || undefined,
    };
    try {
      if (initial) await suppliersApi.update(initial.id, payload);
      else await suppliersApi.create(payload);
      toast.success(initial ? "Supplier updated." : "Supplier added.");
      onSaved();
    } catch (e) {
      toast.error(
        `Could not save supplier: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit Supplier" : "New Supplier"}
    >
      <div className="space-y-3">
        <Field label="Name *">
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Contact person">
          <input
            className="input"
            value={f.contact_person}
            onChange={(e) =>
              setF({ ...f, contact_person: e.target.value })
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Address">
          <textarea
            className="input"
            rows={2}
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
        </Field>
        <Field label="Tax ID / TRN">
          <input
            className="input"
            value={f.tax_id}
            onChange={(e) => setF({ ...f, tax_id: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="input"
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={save}>
          Save Supplier
        </button>
      </div>
    </Modal>
  );
}
