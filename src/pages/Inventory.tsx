import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Boxes,
  AlertTriangle,
  Layers,
  Tag,
  Search,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/DropdownMenu";
import { erp, shareRecord, Product } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, num, numInput, cn } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  Modal,
  Field,
  ShareToggle,
  ErrorBanner,
} from "../components/ui";

export default function Inventory() {
  const { toast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const toggleShare = async (p: Product, next: boolean) => {
    try {
      await shareRecord("products", p.id, next);
      load();
      toast.success(next ? "Shared with your team." : "Set to private.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const load = () => {
    setError("");
    return erp
      .products()
      .then(setProducts)
      .catch((e) =>
        setError(
          `Could not load products: ${e instanceof Error ? e.message : e}`
        )
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(products.map((p) => p.category || "Unsorted"))
      ).sort(),
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (cat === "all" || (p.category || "Unsorted") === cat) &&
          (p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.sku.toLowerCase().includes(q.toLowerCase()))
      ),
    [products, q, cat]
  );

  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const invValue = products.reduce(
    (s, p) => s + p.quantity * p.cost_price,
    0
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inventory"
        subtitle="Products, stock levels & reorder alerts"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New product
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <MetricCard
          label="Total SKUs"
          value={num(products.length)}
          icon={<Boxes size={20} />}
        />
        <MetricCard
          label="Inventory Value"
          value={aed(invValue)}
          icon={<Layers size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Low Stock"
          value={num(lowStock.length)}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
        <MetricCard
          label="Categories"
          value={num(categories.length)}
          icon={<Tag size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-full max-w-xs">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
          />
          <input
            className="input pl-10"
            placeholder="Search products or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCat("all")}
            className={`chip ${cat === "all" ? "chip-active" : ""}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`chip ${cat === c ? "chip-active" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs font-semibold text-brand-400">
          {filtered.length} of {products.length}
        </span>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <DataTable<Product>
        rows={filtered}
        loading={loading}
        empty="No products match your filters"
        columns={[
          {
            key: "sku",
            label: "SKU",
            render: (p) => (
              <span className="font-mono text-xs text-brand-500">{p.sku}</span>
            ),
          },
          {
            key: "name",
            label: "Product",
            render: (p) => (
              <span className="font-semibold text-ink">{p.name}</span>
            ),
          },
          {
            key: "cat",
            label: "Category",
            render: (p) => p.category ?? "—",
          },
          {
            key: "price",
            label: "Unit Price",
            render: (p) => aed(p.unit_price),
          },
          {
            key: "qty",
            label: "Stock",
            render: (p) => (
              <span className="flex items-center gap-2">
                <span className="font-semibold">{p.quantity}</span>
                {p.quantity === 0 ? (
                  <Badge tone="danger">Out</Badge>
                ) : p.quantity <= p.reorder_level ? (
                  <Badge tone="warn">Low</Badge>
                ) : (
                  <Badge tone="success">OK</Badge>
                )}
              </span>
            ),
          },
          {
            key: "share",
            label: "Sharing",
            render: (p) => (
              <ShareToggle
                shared={p.shared}
                onToggle={(next) => toggleShare(p, next)}
              />
            ),
          },
          {
            key: "act",
            label: "",
            render: (p) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`Actions for ${p.name}`}
                    className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink cursor-pointer transition-colors duration-200"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    tone="danger"
                    onSelect={async () => {
                      await erp.deleteProduct(p.id);
                      load();
                    }}
                  >
                    <Trash2 size={14} /> Delete product
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />

      <ProductModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function ProductModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({
    sku: "",
    name: "",
    category: "",
    unit_price: 0,
    cost_price: 0,
    quantity: 0,
    reorder_level: 0,
  });
  const nameErr = !f.name.trim();
  const skuErr = !f.sku.trim();
  const valid = !nameErr && !skuErr;

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
      await erp.createProduct({ ...f, description: "" } as any);
      toast.success("Product added.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Product">
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU *">
          <input
            className={cn("input", touched && skuErr && "border-danger")}
            value={f.sku}
            onChange={(e) => setF({ ...f, sku: e.target.value })}
          />
          {touched && skuErr && (
            <p className="text-[11px] text-danger mt-1">SKU is required.</p>
          )}
        </Field>
        <Field label="Name *">
          <input
            className={cn("input", touched && nameErr && "border-danger")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          {touched && nameErr && (
            <p className="text-[11px] text-danger mt-1">Name is required.</p>
          )}
        </Field>
        <Field label="Category">
          <input
            className="input"
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
          />
        </Field>
        <Field label="Unit Price (AED)">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.unit_price || ""}
            onChange={(e) => setF({ ...f, unit_price: numInput(e.target.value) })}
          />
        </Field>
        <Field label="Cost Price (AED)">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.cost_price || ""}
            onChange={(e) => setF({ ...f, cost_price: numInput(e.target.value) })}
          />
        </Field>
        <Field label="Quantity">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.quantity || ""}
            onChange={(e) => setF({ ...f, quantity: numInput(e.target.value) })}
          />
        </Field>
        <Field label="Reorder Level">
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.reorder_level || ""}
            onChange={(e) => setF({ ...f, reorder_level: numInput(e.target.value) })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={saving || (touched && !valid)}
          onClick={save}
        >
          {saving ? "Saving…" : "Save Product"}
        </button>
      </div>
    </Modal>
  );
}
