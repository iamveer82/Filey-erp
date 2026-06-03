import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Trash2,
  Boxes,
  AlertTriangle,
  Layers,
  Tag,
  Search,
  MoreHorizontal,
  Download,
  Upload,
  Users,
  Lock,
  ScanLine,
  Calendar,
  Hash,
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
import { downloadCsv } from "../lib/csv";
import ImportCsvModal from "../components/ImportCsvModal";
import BarcodeScanner from "../components/BarcodeScanner";
import { aed, num, numInput, cn, getDisplayCurrency, fmtDate } from "../lib/format";
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
  const { toast, confirm } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [batchFilter, setBatchFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") {
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

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
            p.sku.toLowerCase().includes(q.toLowerCase()) ||
            ((p as any).batch_number || "").toLowerCase().includes(q.toLowerCase()) ||
            ((p as any).barcode || "").toLowerCase().includes(q.toLowerCase())) &&
          (!batchFilter || ((p as any).batch_number || "").toLowerCase().includes(batchFilter.toLowerCase()))
      ),
    [products, q, cat, batchFilter]
  );

  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const outOfStock = products.filter((p) => p.quantity === 0);
  const invValue = products.reduce(
    (s, p) => s + p.quantity * p.cost_price,
    0
  );

  const showAlerts = lowStock.length > 0;

  const uniqueBatches = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => (p as any).batch_number)
            .filter((b: any) => b && b.trim())
        )
      ).sort(),
    [products]
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Inventory"
        subtitle="Products, stock levels, batch tracking & barcode scanning"
        action={
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              aria-label="Scan barcode"
              onClick={() => setScanOpen(true)}
              title="Scan barcode or QR code to find product"
            >
              <ScanLine size={15} /> Scan
            </button>
            <button
              className="btn-ghost"
              aria-label="Export products"
              onClick={() =>
                downloadCsv(
                  "products",
                  products as unknown as Record<string, unknown>[],
                  [
                    { key: "sku", label: "SKU" },
                    { key: "name", label: "Name" },
                    { key: "category", label: "Category" },
                    { key: "unit_price", label: "Unit Price" },
                    { key: "cost_price", label: "Cost Price" },
                    { key: "quantity", label: "Quantity" },
                    { key: "reorder_level", label: "Reorder Level" },
                    { key: "batch_number", label: "Batch" },
                    { key: "expiry_date", label: "Expiry" },
                  ]
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button className="btn-ghost" aria-label="Import products" onClick={() => setImportOpen(true)}>
              <Upload size={15} /> Import
            </button>
            <button className="btn-primary" aria-label="New product" onClick={() => setOpen(true)}>
              <Plus size={16} /> New product
            </button>
          </div>
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
            placeholder="Search products, SKU, batch or barcode…"
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
        {uniqueBatches.length > 0 && (
          <div className="flex items-center gap-1.5 ml-2">
            <Hash size={13} className="text-brand-400" />
            <select
              className="select !h-8 text-xs"
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
            >
              <option value="">All batches</option>
              {uniqueBatches.map((b: any) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="ml-auto text-xs font-semibold text-brand-400">
          {filtered.length} of {products.length}
        </span>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {showAlerts && (
        <div className="card mb-4 border-danger/30 bg-danger/5 dark:bg-danger/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-danger" />
            <h3 className="text-sm font-bold text-ink">Stock Alerts</h3>
            <Badge tone="danger">{outOfStock.length} out</Badge>
            <Badge tone="warn">{lowStock.length - outOfStock.length} low</Badge>
            <button
              className="ml-auto text-xs font-semibold text-primary-600 hover:underline"
              onClick={() => {
                setCat("all");
                setQ("");
              }}
            >
              View all inventory
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {lowStock.slice(0, 6).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 dark:border-[#3A3D45] dark:bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-brand-500 font-mono">
                    {p.sku}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-ink">
                    {p.quantity}
                  </span>
                  {p.quantity === 0 ? (
                    <Badge tone="danger">Out</Badge>
                  ) : (
                    <Badge tone="warn">Low</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
          {lowStock.length > 6 && (
            <p className="text-xs text-brand-400 mt-2">
              +{lowStock.length - 6} more items need attention
            </p>
          )}
        </div>
      )}

      <DataTable<Product>
        rows={filtered}
        loading={loading}
        empty="No products match your filters"
        rowKey={(p) => p.id}
        bulkActions={[
          {
            label: "Share",
            icon: <Users size={13} />,
            run: async (sel) => {
              try {
                for (const p of sel) await shareRecord("products", p.id, true);
                load();
                toast.success(`Shared ${sel.length}.`);
              } catch (e: any) {
                toast.error(e?.message || "Failed to share products");
              }
            },
          },
          {
            label: "Make private",
            icon: <Lock size={13} />,
            run: async (sel) => {
              try {
                for (const p of sel) await shareRecord("products", p.id, false);
                load();
                toast.success(`Set ${sel.length} private.`);
              } catch (e: any) {
                toast.error(e?.message || "Failed to set products private");
              }
            },
          },
          {
            label: "Delete",
            icon: <Trash2 size={13} />,
            danger: true,
            run: async (sel) => {
              const ok = await confirm({
                title: "Delete products",
                message: `Delete ${sel.length} product(s)? This cannot be undone.`,
                confirmLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              try {
                for (const p of sel) await erp.deleteProduct(p.id);
                load();
                toast.success(`Deleted ${sel.length}.`);
              } catch (e: any) {
                toast.error(e?.message || "Failed to delete products");
              }
            },
          },
        ]}
        columns={[
          {
            key: "sku",
            label: "SKU",
            sortValue: (p) => p.sku,
            render: (p) => (
              <span className="font-mono text-xs text-brand-500">{p.sku}</span>
            ),
          },
          {
            key: "name",
            label: "Product",
            sortValue: (p) => p.name,
            render: (p) => (
              <span className="font-semibold text-ink">{p.name}</span>
            ),
          },
          {
            key: "batch",
            label: "Batch",
            render: (p) => {
              const bn = (p as any).batch_number as string | undefined;
              const exp = (p as any).expiry_date as string | undefined;
              if (!bn) return <span className="text-brand-400">—</span>;
              return (
                <span className="flex flex-col">
                  <span className="text-xs font-mono font-semibold">{bn}</span>
                  {exp && (
                    <span className="text-[10px] text-brand-400 flex items-center gap-1">
                      <Calendar size={9} />
                      {fmtDate(exp)}
                      {new Date(exp) < new Date() && (
                        <Badge tone="danger">Expired</Badge>
                      )}
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            key: "cat",
            label: "Category",
            sortValue: (p) => p.category ?? "",
            render: (p) => p.category ?? "—",
          },
          {
            key: "price",
            label: "Unit Price",
            sortValue: (p) => p.unit_price,
            render: (p) => aed(p.unit_price),
          },
          {
            key: "qty",
            label: "Stock",
            sortValue: (p) => p.quantity,
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
                    className="rounded-lg p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] cursor-pointer transition-colors duration-200"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    tone="danger"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (!(await confirm({ title: "Delete product", message: `Delete ${p.name}? This cannot be undone.` }))) return;
                      await erp.deleteProduct(p.id);
                      load();
                      toast.success(`Deleted ${p.name}`);
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

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(code) => {
          setQ(code);
          setScanOpen(false);
          toast.info(`Searching for barcode: ${code}`);
        }}
        title="Scan Product Barcode"
      />

      <ImportCsvModal
        open={importOpen}
        title="Import products"
        onClose={() => setImportOpen(false)}
        onImport={async (rows) => {
          for (const r of rows) {
            if (!String(r.name ?? "").trim()) continue;
            await erp.createProduct({
              sku: String(r.sku ?? ""),
              name: String(r.name ?? ""),
              category: String(r.category ?? "") || undefined,
              unit_price: Number(r.unit_price) || 0,
              cost_price: Number(r.cost_price) || 0,
              quantity: Number(r.quantity) || 0,
              reorder_level: Number(r.reorder_level) || 0,
              description: "",
            } as Omit<Product, "id" | "created_at">);
          }
          load();
        }}
        fields={[
          { key: "sku", label: "SKU" },
          { key: "name", label: "Name", required: true },
          { key: "category", label: "Category" },
          { key: "unit_price", label: "Unit Price" },
          { key: "cost_price", label: "Cost Price" },
          { key: "quantity", label: "Quantity" },
          { key: "reorder_level", label: "Reorder Level" },
        ]}
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
    batch_number: "",
    expiry_date: "",
    barcode: "",
    warehouse: "",
    is_serialized: false,
  });
  const nameErr = !f.name.trim();
  const skuErr = !f.sku.trim();
  const valid = !nameErr && !skuErr;

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
      await erp.createProduct({
        ...f,
        description: "",
        batch_number: f.batch_number || undefined,
        expiry_date: f.expiry_date || undefined,
        barcode: f.barcode || undefined,
      } as any);
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
        <Field label="Barcode / EAN">
          <input
            className="input"
            placeholder="Scan or type"
            value={f.barcode}
            onChange={(e) => setF({ ...f, barcode: e.target.value })}
          />
        </Field>
        <Field label="Warehouse / Location">
          <input
            className="input"
            placeholder="Main Warehouse"
            value={f.warehouse}
            onChange={(e) => setF({ ...f, warehouse: e.target.value })}
          />
        </Field>
        <Field label={`Unit Price (${getDisplayCurrency()})`}>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={f.unit_price || ""}
            onChange={(e) => setF({ ...f, unit_price: numInput(e.target.value) })}
          />
        </Field>
        <Field label={`Cost Price (${getDisplayCurrency()})`}>
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
        <Field label="Batch / Lot Number">
          <input
            className="input"
            placeholder="LOT-2026-001"
            value={f.batch_number}
            onChange={(e) => setF({ ...f, batch_number: e.target.value })}
          />
        </Field>
        <Field label="Expiry Date">
          <input
            type="date"
            className="input"
            value={f.expiry_date}
            onChange={(e) => setF({ ...f, expiry_date: e.target.value })}
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
