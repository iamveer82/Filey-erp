import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Download,
  Upload,
  Users,
  Lock,
  ScanLine,
  Calendar,
  Hash,
  Pencil,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  ClipboardList,
  Loader2,
  ChevronDown,
} from "lucide-react";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { erp, pos, shareRecord, billing, Product, type StockMovement } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { MenuPopover, MenuItemRow } from "../components/ui-menu";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import ImportCsvModal from "../components/ImportCsvModal";
import BarcodeScanner from "../components/BarcodeScanner";
import { aed, num, numInput, cn, getDisplayCurrency, fmtDate, todayYmd } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Card,
  DataTable,
  Badge,
  Modal,
  Field,
  ShareToggle,
  ErrorBanner,
  SearchInput,
  FilterChip,
} from "../components/ui";
import { DateField } from "../components/DatePicker";

/** Expiring = still in stock and expiry date within 30 days (or already past). */
function isExpiring(p: Product): boolean {
  if (!p.expiry_date || p.quantity <= 0) return false;
  const d = new Date(p.expiry_date).getTime();
  if (Number.isNaN(d)) return false;
  return d - Date.now() <= 30 * 24 * 60 * 60 * 1000;
}

export default function Inventory() {
  const { toast, confirm } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [issueFor, setIssueFor] = useState<Product | null>(null);
  const [issues, setIssues] = useState<Record<string, StockMovement[]>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [batchFilter, setBatchFilter] = useState("");
  const [draftingPo, setDraftingPo] = useState(false);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") {
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const draftPoFromLowStock = async () => {
    const ok = await confirm({
      title: "Draft purchase orders",
      message:
        "Create draft PO(s) for all low-stock products, grouped by supplier? You can edit quantities before sending.",
      confirmLabel: "Create drafts",
    });
    if (!ok) return;
    setDraftingPo(true);
    try {
      const nums = await pos.createDraftsFromLowStock();
      toast.success(
        nums.length
          ? `Created ${nums.join(", ")} - see Purchase Orders.`
          : "Nothing to reorder (set reorder levels first)."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftingPo(false);
    }
  };

  const toggleShare = async (p: Product, next: boolean) => {
    try {
      await shareRecord("products", p.id, next);
      load();
      toast.success(next ? "Shared with your team." : "Set to private.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Row actions (DEMO parity) ----
  const editProduct = (p: Product) => {
    setEditing(p);
    setOpen(true);
  };

  const deleteProduct = async (p: Product) => {
    if (
      !(await confirm({
        title: "Delete product",
        message: `Delete ${p.name}? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await erp.deleteProduct(p.id);
      toast.success(`Deleted ${p.name}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete product"
      );
    }
    load();
  };

  // Duplicates the product definition only — batch/expiry/barcode are
  // lot-specific and stock starts at 0 so the ledger stays consistent.
  const duplicateProduct = async (p: Product) => {
    try {
      await erp.createProduct({
        sku: `${p.sku}-COPY`,
        name: `${p.name} (Copy)`,
        description: p.description ?? "",
        category: p.category,
        unit_price: p.unit_price,
        cost_price: p.cost_price,
        quantity: 0,
        reorder_level: p.reorder_level,
        unit: p.unit,
        warehouse: p.warehouse,
        is_serialized: p.is_serialized,
        custom_fields: p.custom_fields,
      } as Omit<Product, "id" | "created_at">);
      toast.success(`Duplicated ${p.name} - stock starts at 0.`);
      load();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to duplicate product"
      );
    }
  };

  const shareProduct = (kind: ShareKind, p: Product) => {
    const url = `${location.origin}${location.pathname}#/inventory`;
    const text = `${p.name} (${p.sku}) - In stock: ${p.quantity}, Unit price: ${aed(p.unit_price)}`;
    shareVia(kind, { text, url });
    if (kind === "copyLink") toast.success("Inventory link copied");
  };

  const load = () => {
    setError("");
    erp.stockMovements().then(setIssues).catch(() => {});
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
  // Total units that left stock (sales, orders, manual issues) — any negative movement.
  const issuedTotal = (p: Product) =>
    (issues[String(p.id)] ?? []).reduce((s, m) => s + (m.qty < 0 ? -m.qty : 0), 0);
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
        (p) => {
          // Category / status chip
          let matchCat = true;
          if (cat === "__low__") {
            matchCat = p.quantity > 0 && p.quantity <= p.reorder_level;
          } else if (cat === "__out__") {
            matchCat = p.quantity === 0;
          } else if (cat === "__exp__") {
            matchCat = isExpiring(p);
          } else if (cat !== "all") {
            matchCat = (p.category || "Unsorted") === cat;
          }
          return (
            matchCat &&
            (p.name.toLowerCase().includes(q.toLowerCase()) ||
              p.sku.toLowerCase().includes(q.toLowerCase()) ||
              (p.batch_number || "").toLowerCase().includes(q.toLowerCase()) ||
              (p.barcode || "").toLowerCase().includes(q.toLowerCase())) &&
            (!batchFilter ||
              (p.batch_number || "")
                .toLowerCase()
                .includes(batchFilter.toLowerCase()))
          );
        }
      ),
    [products, q, cat, batchFilter]
  );

  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const outOfStock = products.filter((p) => p.quantity === 0);
  const expiring = products.filter(isExpiring);
  // Guard unset/NaN prices so a product with no cost price adds 0 (not NaN).
  const invValue = products.reduce(
    (s, p) => s + (Number(p.quantity) || 0) * (Number(p.cost_price) || 0),
    0
  );

  const showAlerts = lowStock.length > 0;

  const uniqueBatches = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => p.batch_number)
            .filter((b): b is string => !!b && !!b.trim())
        )
      ).sort(),
    [products]
  );

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels and reorder alerts"
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
            <button
              className="btn-ghost"
              aria-label="Stocktake"
              onClick={() => setStocktakeOpen(true)}
            >
              <ClipboardList size={15} /> Stocktake
            </button>
            <button className="btn-primary" aria-label="Add item" onClick={() => setOpen(true)}>
              <Plus size={16} /> Add item
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Total SKUs"
          value={num(products.length)}
          change={`${categories.length} categories`}
          changeTone="up"
        />
        <MetricCard
          label="Stock Value"
          value={aed(invValue)}
          change="At cost"
          changeTone="up"
        />
        <MetricCard
          label="Low Stock"
          value={num(lowStock.length)}
          change={lowStock.length > 0 ? "Needs reorder" : "All good"}
          changeTone={lowStock.length > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="Out of Stock"
          value={num(outOfStock.length)}
          change={outOfStock.length > 0 ? "Restock needed" : "None"}
          changeTone={outOfStock.length > 0 ? "down" : "up"}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {showAlerts && (
        <InfoCard title="Stock Alerts" className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-danger/10">
              <AlertTriangle size={18} className="text-danger" />
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="danger">{outOfStock.length} out</Badge>
              <Badge tone="warn">{lowStock.length - outOfStock.length} low</Badge>
            </div>
            <button
              className="ml-auto text-xs font-medium text-brand-500 hover:text-ink"
              onClick={() => {
                setCat("all");
                setQ("");
              }}
            >
              View all inventory
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStock.slice(0, 6).map((p) => (
              <Card key={p.id} className="p-3 flex items-center justify-between gap-3 transition-[border-color] duration-200 hover:border-muted-foreground/40" hover>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate tracking-tight">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-medium">
                    {p.sku}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-ink tabular-nums tracking-tight">
                    {p.quantity}
                  </span>
                  {p.quantity === 0 ? (
                    <Badge tone="danger">Out</Badge>
                  ) : (
                    <Badge tone="warn">Low</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
          {lowStock.length > 6 && (
            <p className="text-xs text-muted-foreground mt-3 font-medium">
              +{lowStock.length - 6} more items need attention
            </p>
          )}
        </InfoCard>
      )}

      <div className="card overflow-hidden p-0 [&_.card]:rounded-none [&_.card]:border-0">
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3 border-b border-border">
          <SearchInput
            className="w-full max-w-xs"
            value={q}
            onChange={setQ}
            placeholder="Search SKU, name or category"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={cat === "all"} onClick={() => setCat("all")} count={products.length}>
              All
            </FilterChip>
            {lowStock.length > 0 && (
              <>
                <FilterChip
                  active={cat === "__low__"}
                  onClick={() => setCat("__low__")}
                  count={lowStock.length}
                  tone="warn"
                >
                  Low stock
                </FilterChip>
                <button
                  className="btn-ghost text-xs"
                  disabled={draftingPo}
                  onClick={draftPoFromLowStock}
                >
                  {draftingPo ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ShoppingCart size={14} />
                  )}
                  Draft PO from low stock
                </button>
              </>
            )}
            {outOfStock.length > 0 && (
              <FilterChip
                active={cat === "__out__"}
                onClick={() => setCat("__out__")}
                count={outOfStock.length}
                tone="danger"
              >
                Out of stock
              </FilterChip>
            )}
            {expiring.length > 0 && (
              <FilterChip
                active={cat === "__exp__"}
                onClick={() => setCat("__exp__")}
                count={expiring.length}
                tone="warn"
              >
                <Calendar size={12} /> Expiring soon
              </FilterChip>
            )}
            {categories.map((c) => (
              <FilterChip
                key={c}
                active={cat === c}
                onClick={() => setCat(c)}
              >
                {c}
              </FilterChip>
            ))}
          </div>
          {uniqueBatches.length > 0 && (
            <BatchFilter
              batches={uniqueBatches}
              value={batchFilter}
              onChange={setBatchFilter}
            />
          )}
          <span className="ml-auto text-[11px] font-medium text-brand-500 tracking-tight">
            {filtered.length} shown
          </span>
        </div>
        <DataTable<Product>
          pageSize={10}
          rows={filtered}
          loading={loading}
          empty="No products match your filters"
          rowKey={(p) => p.id}
          bulkActions={[
            {
              label: "Share",
              icon: <Users size={14} />,
              run: async (sel) => {
                try {
                  for (const p of sel) await shareRecord("products", p.id, true);
                  load();
                  toast.success(`Shared ${sel.length}.`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to share products");
                }
              },
            },
            {
              label: "Make private",
              icon: <Lock size={14} />,
              run: async (sel) => {
                try {
                  for (const p of sel) await shareRecord("products", p.id, false);
                  load();
                  toast.success(`Set ${sel.length} private.`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to set products private");
                }
              },
            },
            {
              label: "Delete",
              icon: <Trash2 size={14} />,
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
                  await erp.deleteProducts(sel.map((p) => p.id));
                  load();
                  toast.success(`Deleted ${sel.length}.`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to delete products");
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
                <span className="text-xs text-brand-500 font-medium">{p.sku}</span>
              ),
            },
            {
              key: "name",
              label: "Item",
              sortValue: (p) => p.name,
              render: (p) => (
                <span className="font-semibold text-ink">{p.name}</span>
              ),
            },
            {
              key: "cat",
              label: "Category",
              sortValue: (p) => p.category ?? "",
              render: (p) => (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-hover text-foreground ring-1 ring-border">
                  {p.category || "—"}
                </span>
              ),
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
              key: "reorder",
              label: "Reorder at",
              sortValue: (p) => p.reorder_level,
              render: (p) => (
                <span className="text-muted-foreground">{num(p.reorder_level)}</span>
              ),
            },
            {
              key: "price",
              label: "Unit price",
              sortValue: (p) => p.unit_price,
              render: (p) => aed(p.unit_price),
            },
            {
              key: "batch",
              label: "Batch",
              render: (p) => {
                const bn = p.batch_number as string | undefined;
                const exp = p.expiry_date as string | undefined;
                if (!bn) return <span className="text-brand-400">—</span>;
                return (
                  <span className="flex flex-col">
                    <span className="text-xs font-medium">{bn}</span>
                    {exp && (
                      <span className="text-[10px] text-brand-500 flex items-center gap-1">
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
              key: "issued",
              label: "Issued out",
              sortValue: (p) => issuedTotal(p),
              render: (p) => {
                const t = issuedTotal(p);
                return t > 0 ? (
                  <span className="font-medium text-brand-600">{t}</span>
                ) : (
                  <span className="text-brand-400">—</span>
                );
              },
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
              label: "Actions",
              render: (p) => (
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIssueFor(p);
                    }}
                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover border border-transparent hover:border-border transition-colors"
                    title="Stock entry"
                    aria-label={`Stock entry for ${p.name}`}
                  >
                    <PackageMinus className="h-3.5 w-3.5" />
                  </button>
                  <RowActions
                    onView={() => setQuickView(p)}
                    onEdit={() => editProduct(p)}
                    onCopy={() => duplicateProduct(p)}
                    onDelete={() => deleteProduct(p)}
                    onSend={{
                      whatsapp: () => shareProduct("whatsapp", p),
                      email: () => shareProduct("email", p),
                      sms: () => shareProduct("sms", p),
                      copyLink: () => shareProduct("copyLink", p),
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      <ProductModal
        open={open}
        product={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSaved={load}
      />

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const p = quickView;
                setQuickView(null);
                editProduct(p);
              }
            : undefined
        }
        data={
          quickView
            ? {
                title: quickView.name,
                subtitle: `SKU ${quickView.sku}`,
                badge:
                  quickView.quantity === 0 ? (
                    <Badge tone="danger">Out of stock</Badge>
                  ) : quickView.quantity <= quickView.reorder_level ? (
                    <Badge tone="warn">Low stock</Badge>
                  ) : (
                    <Badge tone="success">In stock</Badge>
                  ),
                meta: [
                  { label: "Category", value: quickView.category },
                  { label: "In stock", value: num(quickView.quantity) },
                  { label: "Reorder at", value: num(quickView.reorder_level) },
                  {
                    label: "Issued out",
                    value: issuedTotal(quickView) || undefined,
                  },
                  { label: "Unit price", value: aed(quickView.unit_price) },
                  { label: "Cost price", value: aed(quickView.cost_price) },
                  {
                    label: "Stock value (cost)",
                    value: aed(
                      (Number(quickView.quantity) || 0) *
                        (Number(quickView.cost_price) || 0)
                    ),
                  },
                  { label: "Batch / lot", value: quickView.batch_number },
                  {
                    label: "Expiry date",
                    value: quickView.expiry_date
                      ? fmtDate(quickView.expiry_date)
                      : undefined,
                  },
                  { label: "Barcode", value: quickView.barcode },
                  { label: "Warehouse", value: quickView.warehouse },
                  {
                    label: "Added",
                    value: quickView.created_at
                      ? fmtDate(quickView.created_at)
                      : undefined,
                  },
                ],
                notes: quickView.description || undefined,
              }
            : null
        }
      />

      <IssueStockModal
        product={issueFor}
        history={issueFor ? issues[String(issueFor.id)] ?? [] : []}
        onClose={() => setIssueFor(null)}
        onSaved={load}
      />

      <StocktakeModal
        open={stocktakeOpen}
        products={products}
        onClose={() => setStocktakeOpen(false)}
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
          let ok = 0;
          const failed: string[] = [];
          const toProduct = (r: Record<string, unknown>) =>
            ({
              sku: String(r.sku ?? ""),
              name: String(r.name ?? ""),
              category: String(r.category ?? "") || undefined,
              unit_price: Number(r.unit_price) || 0,
              cost_price: Number(r.cost_price) || 0,
              quantity: Number(r.quantity) || 0,
              reorder_level: Number(r.reorder_level) || 0,
              description: "",
            }) as Omit<Product, "id" | "created_at">;
          const usable = rows.filter((r) => String(r.name ?? "").trim());
          try {
            // One write for the whole file. Row-at-a-time reloads and rewrites
            // the entire collection per product, which is what made a big
            // import look like a hang.
            await erp.createProducts(usable.map(toProduct));
            ok = usable.length;
          } catch {
            // A bulk insert is all-or-nothing, so it cannot say WHICH row was
            // bad. Only a failed import pays for finding out.
            for (const r of usable) {
              try {
                await erp.createProduct(toProduct(r));
                ok++;
              } catch {
                failed.push(String(r.name));
              }
            }
          }
          if (failed.length) {
            toast.error(
              `Imported ${ok} product${ok === 1 ? "" : "s"}; ${failed.length} failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`
            );
          } else if (ok) {
            toast.success(`Imported ${ok} product${ok === 1 ? "" : "s"}.`);
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

/** Toolbar batch filter — the app's shared menu instead of a native select,
 *  so the filter row reads like every other dropdown in the app. */
function BatchFilter({
  batches,
  value,
  onChange,
}: {
  batches: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex items-center gap-1.5 ml-2">
      <Hash size={13} className="text-brand-400" />
      <button
        type="button"
        ref={btnRef}
        aria-label="Filter by batch"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-foreground transition-colors hover:bg-hover"
      >
        <span className="max-w-[120px] truncate">{value || "All batches"}</span>
        <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
      </button>
      <MenuPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        closeOnScroll
        className="w-44"
      >
        <MenuItemRow
          label="All batches"
          checked={value === ""}
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
        />
        {batches.length > 0 && batches.some((b) => b !== "") && (
          <div className="mx-2 my-1 border-t border-border" />
        )}
        {batches.map((b) =>
          b === "" ? null : (
            <MenuItemRow
              key={b}
              label={b}
              checked={value === b}
              onClick={() => {
                onChange(b);
                setOpen(false);
              }}
            />
          )
        )}
      </MenuPopover>
    </div>
  );
}

function ProductModal({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product?: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [customFields, setCustomFields] = useState<
    { key: string; value: string }[]
  >([]);
  const addField = () =>
    setCustomFields((cf) => [...cf, { key: "", value: "" }]);
  const updateField = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setCustomFields((cf) => cf.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeField = (i: number) =>
    setCustomFields((cf) => cf.filter((_, idx) => idx !== i));
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
    purchase_date: "",
    barcode: "",
    warehouse: "",
    is_serialized: false,
  });
  const nameErr = !f.name.trim();
  const skuErr = !f.sku.trim();
  const valid = !nameErr && !skuErr;

  // Populate (edit) or reset (new) the form whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (product) {
      setF({
        sku: product.sku ?? "",
        name: product.name ?? "",
        category: product.category ?? "",
        unit_price: product.unit_price ?? 0,
        cost_price: product.cost_price ?? 0,
        quantity: product.quantity ?? 0,
        reorder_level: product.reorder_level ?? 0,
        batch_number: product.batch_number ?? "",
        expiry_date: product.expiry_date ?? "",
        purchase_date: String(product.custom_fields?.purchase_date ?? ""),
        barcode: product.barcode ?? "",
        warehouse: product.warehouse ?? "",
        is_serialized: product.is_serialized ?? false,
      });
      setCustomFields(
        Object.entries(product.custom_fields ?? {})
          .filter(([key]) => key !== "purchase_date")
          .map(([key, value]) => ({
            key,
            value: String(value),
          }))
      );
    } else {
      setF({
        sku: "",
        name: "",
        category: "",
        unit_price: 0,
        cost_price: 0,
        quantity: 0,
        reorder_level: 0,
        batch_number: "",
        expiry_date: "",
        purchase_date: "",
        barcode: "",
        warehouse: "",
        is_serialized: false,
      });
      setCustomFields([]);
    }
  }, [open, product]);

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
      // purchase_date isn't a products column — it rides in custom_fields.
      const { purchase_date, ...fCols } = f;
      const custom: Record<string, string> = Object.fromEntries(
        customFields
          .filter((c) => c.key.trim())
          .map((c) => [c.key.trim(), c.value])
      );
      if (purchase_date) custom.purchase_date = purchase_date;
      const payload = {
        ...fCols,
        batch_number: fCols.batch_number || undefined,
        expiry_date: fCols.expiry_date || undefined,
        barcode: fCols.barcode || undefined,
        warehouse: fCols.warehouse || undefined,
        // Send {} (not undefined) when editing so clearing all fields persists.
        custom_fields: Object.keys(custom).length
          ? custom
          : product
          ? {}
          : undefined,
      };
      if (product) {
        // Quantity changes go through the stock ledger (atomic + logged as an
        // adjustment) instead of being silently overwritten with the rest of
        // the form.
        const qtyDiff = (Number(f.quantity) || 0) - (Number(product.quantity) || 0);
        const { quantity: _q, ...rest } = payload;
        await erp.updateProduct(
          product.id,
          rest as Partial<Omit<Product, "id" | "created_at">>
        );
        if (qtyDiff !== 0)
          await erp.recordStockEntry(
            product.id,
            "adjust",
            qtyDiff,
            "",
            "Edited in product form"
          );
        toast.success("Product updated.");
      } else {
        await erp.createProduct({
          ...payload,
          description: "",
        } as Omit<Product, "id" | "created_at">);
        toast.success("Product added.");
      }
      onSaved();
      setCustomFields([]);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? "Edit Product" : "New Product"}
    >
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
          <DateField
            value={f.expiry_date}
            onChange={(v) => setF({ ...f, expiry_date: v })}
          />
        </Field>
        <Field label="Date of purchase">
          <DateField
            value={f.purchase_date}
            onChange={(v) => setF({ ...f, purchase_date: v })}
          />
        </Field>
      </div>

      <div className="mt-4 border-t border-brand-100 dark:border-white/10 pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[13px] font-medium text-brand-500">Custom fields</label>
          <button
            type="button"
            className="btn-ghost !h-7 !px-2 text-xs"
            onClick={addField}
          >
            <Plus size={13} /> Add field
          </button>
        </div>
        {customFields.length === 0 ? (
          <p className="text-[11px] text-brand-500">
            Add your own attributes (e.g. Color, Material, Voltage, Origin).
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {customFields.map((cf, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Field name"
                  value={cf.key}
                  onChange={(e) => updateField(i, { key: e.target.value })}
                />
                <input
                  className="input flex-1"
                  placeholder="Value"
                  value={cf.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Remove field"
                  className="rounded-full p-1.5 text-brand-400 hover:bg-danger/10 hover:text-danger transition-colors duration-200"
                  onClick={() => removeField(i)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
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
          {saving ? "Saving…" : product ? "Save changes" : "Save Product"}
        </button>
      </div>
    </Modal>
  );
}

/** Count-sheet stocktake: type the physically counted quantity per product;
 *  every non-empty count that differs from book stock posts one adjustment
 *  movement. Rows left blank are untouched. */
function StocktakeModal({
  open,
  products,
  onClose,
  onSaved,
}: {
  open: boolean;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (open) {
      setCounts({});
      setFilter("");
    }
  }, [open]);

  const rows = products.filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.sku.toLowerCase().includes(filter.toLowerCase())
  );

  const diffs = products
    .map((p) => {
      const raw = counts[p.id];
      if (raw === undefined || raw.trim() === "") return null;
      const counted = Number(raw);
      if (!Number.isFinite(counted) || counted < 0) return null;
      const diff = Math.trunc(counted) - p.quantity;
      return diff === 0 ? null : { p, counted: Math.trunc(counted), diff };
    })
    .filter(Boolean) as { p: Product; counted: number; diff: number }[];

  const post = async () => {
    if (!diffs.length) return;
    setPosting(true);
    try {
      for (const d of diffs) {
        await erp.recordStockEntry(
          d.p.id,
          "adjust",
          d.diff,
          "Stocktake",
          `Counted ${d.counted}, book ${d.p.quantity}`
        );
      }
      toast.success(`Stocktake posted - ${diffs.length} adjustment(s).`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Stocktake: physical count" size="2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          className="input max-w-xs"
          placeholder="Filter by name or SKU…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <p className="text-xs text-brand-400 shrink-0">
          Leave a row blank to skip it.
        </p>
      </div>

      <div className="overflow-auto rounded-xl border border-brand-100 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-brand-50 text-left">
            <tr className="text-[11px] uppercase tracking-wider text-brand-400">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium text-right">Book</th>
              <th className="px-3 py-2 font-medium w-32">Counted</th>
              <th className="px-3 py-2 font-medium text-right">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const raw = counts[p.id] ?? "";
              const counted = raw.trim() === "" ? null : Number(raw);
              const diff =
                counted === null || !Number.isFinite(counted)
                  ? null
                  : Math.trunc(counted) - p.quantity;
              return (
                <tr key={p.id} className="border-t border-brand-100 dark:border-white/10">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.sku && (
                      <span className="ml-2 text-xs text-brand-400">{p.sku}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.quantity}</td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      className="input !h-8 tabular-nums"
                      placeholder="—"
                      value={raw}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [p.id]: e.target.value }))
                      }
                    />
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      diff === null || diff === 0
                        ? "text-brand-400"
                        : diff < 0
                          ? "text-danger"
                          : "text-success"
                    )}
                  >
                    {diff === null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-brand-400 text-sm">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-brand-400">
          {diffs.length
            ? `${diffs.length} product(s) will be adjusted.`
            : "No differences entered yet."}
        </p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={posting || !diffs.length}
            onClick={post}
          >
            {posting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ClipboardList size={15} />
            )}
            Post adjustments
          </button>
        </div>
      </div>
    </Modal>
  );
}

function IssueStockModal({
  product,
  history,
  onClose,
  onSaved,
}: {
  product: Product | null;
  history: StockMovement[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [mode, setMode] = useState<"out" | "in" | "adjust">("out");
  const [invoice, setInvoice] = useState("");
  const [qty, setQty] = useState(0);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [invNumbers, setInvNumbers] = useState<string[]>([]);

  useEffect(() => {
    if (!product) return;
    setMode("out");
    setInvoice("");
    setQty(0);
    setCounted(null);
    setNote("");
    setDate(todayYmd());
    billing
      .listDocs()
      .then((docs) =>
        setInvNumbers(
          (docs as unknown as { number?: string }[])
            .map((d) => d.number)
            .filter((n): n is string => !!n)
        )
      )
      .catch(() => setInvNumbers([]));
  }, [product]);

  if (!product) return null;

  const stock = product.quantity;
  const issuedSoFar = history.reduce((s, m) => s + (m.qty < 0 ? -m.qty : 0), 0);
  const delta = counted === null ? 0 : counted - stock;
  const qtyErr =
    mode === "adjust"
      ? counted === null || counted < 0 || delta === 0
      : qty <= 0 || (mode === "out" && qty > stock);
  const invErr = mode === "out" && !invoice.trim();
  const after =
    mode === "out" ? stock - qty : mode === "in" ? stock + qty : counted ?? stock;

  const submit = async () => {
    if (qtyErr || invErr) return;
    setSaving(true);
    try {
      const q = mode === "adjust" ? delta : qty;
      await erp.recordStockEntry(product.id, mode, q, invoice, note, date);
      toast.success(
        mode === "out"
          ? `Issued ${qty} × ${product.name} to ${invoice.trim()}`
          : mode === "in"
            ? `Received ${qty} × ${product.name}`
            : `Adjusted ${product.name} to ${counted} (${delta > 0 ? "+" : ""}${delta})`
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const entryLabel = { out: "Stock out", in: "Stock in", adjust: "Adjust count" }[mode];
  const typeLabel: Record<string, string> = {
    sale: "Invoice",
    purchase: "Purchase",
    order: "Order",
    in: "Stock in",
    out: "Stock out",
    adjust: "Adjustment",
  };

  return (
    <Modal open={!!product} onClose={onClose} title={`Stock entry - ${product.name}`}>
      {/* entry type */}
      <div className="mb-4 flex items-center gap-1 rounded-xl bg-brand-50 p-1 dark:bg-white/5 w-fit">
        {(
          [
            ["out", "Stock out"],
            ["in", "Stock in"],
            ["adjust", "Adjust"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
              mode === m ? "bg-primary-100 text-primary-700" : "text-brand-400"
            )}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-6 rounded-xl bg-brand-50 px-4 py-3 dark:bg-white/5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-brand-400">In stock</p>
          <p className="text-lg font-semibold text-ink">{stock}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-brand-400">Issued out</p>
          <p className="text-lg font-semibold text-brand-600">{issuedSoFar}</p>
        </div>
        {!qtyErr && (qty > 0 || counted !== null) && (
          <div className="ml-auto text-right">
            <p className="text-[11px] font-medium uppercase tracking-wider text-brand-400">After this</p>
            <p className="text-lg font-semibold text-ink">{after} left</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {mode === "out" ? (
          <Field label="Invoice / reference *">
            <input
              className={cn("input", invErr && "border-danger")}
              list="issue-inv-numbers"
              placeholder="INV-2026-0001"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
            />
            <datalist id="issue-inv-numbers">
              {invNumbers.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
        ) : (
          <Field label="Reference (optional)">
            <input
              className="input"
              placeholder={mode === "in" ? "GRN / PO / supplier ref" : "e.g. stock count"}
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
            />
          </Field>
        )}
        {mode === "adjust" ? (
          <Field label="Counted quantity *">
            <input
              type="number"
              className={cn("input", counted !== null && counted < 0 && "border-danger")}
              placeholder={String(stock)}
              value={counted ?? ""}
              onChange={(e) =>
                setCounted(e.target.value === "" ? null : numInput(e.target.value))
              }
            />
            {counted !== null && delta !== 0 && (
              <p className={cn("mt-1 text-[11px]", delta < 0 ? "text-danger" : "text-brand-500")}>
                {delta > 0 ? "+" : ""}
                {delta} vs current stock
              </p>
            )}
          </Field>
        ) : (
          <Field label="Quantity *">
            <input
              type="number"
              className={cn("input", mode === "out" && qty > stock && "border-danger")}
              placeholder="0"
              value={qty || ""}
              onChange={(e) => setQty(numInput(e.target.value))}
            />
            {mode === "out" && qty > stock && (
              <p className="mt-1 text-[11px] text-danger">Only {stock} in stock.</p>
            )}
          </Field>
        )}
        <Field label="Date">
          <DateField value={date} onChange={setDate} clearable={false} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Note (optional)">
          <input
            className="input"
            placeholder={
              mode === "out"
                ? "e.g. delivered to customer site"
                : mode === "in"
                  ? "e.g. received from supplier"
                  : "e.g. physical count correction"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      {history.length > 0 && (
        <div className="mt-4 border-t border-brand-100 pt-3 dark:border-white/10">
          <p className="mb-2 text-[13px] font-medium text-brand-500">Movement history</p>
          <div className="max-h-40 space-y-1.5 overflow-auto">
            {[...history].reverse().map((h, i) => (
              <div key={h.id ?? i} className="flex items-center justify-between text-xs">
                <span className="min-w-0 truncate font-medium text-ink">
                  {h.ref || typeLabel[h.type] || "—"}
                  {h.note ? <span className="text-brand-400"> · {h.note}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className={h.qty < 0 ? "text-danger" : "text-success"}>
                    {h.qty > 0 ? "+" : ""}
                    {h.qty}
                  </span>
                  <span className="text-brand-500"> · {fmtDate(h.moved_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={saving || qtyErr || invErr}
          onClick={submit}
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : mode === "in" ? (
            <PackagePlus size={15} />
          ) : mode === "adjust" ? (
            <Pencil size={15} />
          ) : (
            <PackageMinus size={15} />
          )}
          {entryLabel}
        </button>
      </div>
    </Modal>
  );
}
