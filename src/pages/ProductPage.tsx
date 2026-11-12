import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Camera, Check, Layers, Plus, Printer, ScanBarcode, Sparkles, Trash2 } from "lucide-react";
import { erp, suppliers, type Product, type Supplier } from "../lib/api";
import { cn, fmtDate, getDisplayCurrency, money, numInput, todayYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import { DateField } from "../components/DatePicker";
import BarcodeScanner from "../components/BarcodeScanner";
import BatchesModal from "../components/BatchesModal";
import { batchStock, expiryFrom, readBatches } from "../lib/batches";
import { barcodeKind, barcodeSvg, expectedCheckDigit, generateEan13, labelSheetHtml, type LabelSize } from "../lib/barcode";
import { printHtml } from "../lib/receipt";
import { blankProduct, checkProduct, formFromProduct, saveProduct, skuFromName, type CustomField, type ProductForm } from "../lib/productForm";

const UNITS = ["pcs", "box", "pack", "strip", "bottle", "kg", "g", "L", "ml", "m", "dozen"];
const LABEL_KEY = "filey_label_prefs";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function labelPrefs(): { size: LabelSize; copies: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LABEL_KEY) || "{}");
    return { size: ["38x25", "50x25", "a4"].includes(v.size) ? v.size : "50x25", copies: Number(v.copies) > 0 ? Math.min(500, Number(v.copies)) : 1 };
  } catch {
    return { size: "50x25", copies: 1 };
  }
}

/** One numbered step of the form. */
function Step({ n, title, hint, children, aside }: { n: number | string; title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-border bg-card p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background">{n}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {aside}
    </div>
    {children}
  </section>;
}
function Field({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return <label className={cn("block min-w-0 text-xs font-medium text-muted-foreground", className)}>{label}
    <div className="mt-1.5">{children}</div>
    {error && <span role="alert" className="mt-1 block text-[11px] text-danger">{error}</span>}
  </label>;
}

/** The colour a product's initials sit on, steady for the same name. */
const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Add or edit a product on its own page, barcode first: scan it, type it, or let Filey make an
 *  in-store EAN-13, then fill in what it is, its price, stock and batches, with a live preview of
 *  how it shows at the counter and its printable barcode label. */
export default function ProductPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const { toast } = useUI();
  const today = todayYmd();
  const ccy = getDisplayCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState<ProductForm>(blankProduct);
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [vendors, setVendors] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [scan, setScan] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);
  const [label, setLabel] = useState(labelPrefs);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await erp.products({ fresh: true });
      setProducts(list);
      if (!isNew) {
        const p = list.find((x) => String(x.id) === id) ?? null;
        setProduct(p);
        setMissing(!p);
        if (p) { const { form, custom: c } = formFromProduct(p); setF(form); setCustom(c); }
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
    // toast is recreated each render; loading must not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);
  useEffect(() => { void load(); suppliers.list().then(setVendors).catch(() => setVendors([])); }, [load]);

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const others = useMemo(() => products.filter((p) => p.id !== product?.id), [products, product]);
  const check = checkProduct(f, isNew, others);
  const valid = Object.keys(check).length === 0;
  const kind = barcodeKind(f.barcode);
  // Same proportions as the printed label.
  const svg = barcodeSvg(f.barcode, { height: 40 });
  const clash = f.barcode.trim() ? others.find((p) => (p.barcode ?? "").trim() === f.barcode.trim()) : undefined;
  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of products) if (p.category?.trim()) count.set(p.category.trim(), (count.get(p.category.trim()) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [products]);
  const margin = f.unit_price > 0 ? (f.unit_price - f.cost_price) / f.unit_price * 100 : null;
  const batches = product ? batchStock(readBatches(product), Number(product.quantity) || 0, today).batches.filter((b) => b.left > 0) : [];
  const obExp = expiryFrom(f.obExp);
  const nextExpiry = isNew ? obExp : batches.find((b) => !b.expired)?.exp ?? f.expiry_date;
  const daysToExpiry = nextExpiry ? Math.round((Date.parse(`${nextExpiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
  const low = f.reorder_level > 0 && f.quantity <= f.reorder_level;

  const generate = () => {
    try { set("barcode", generateEan13(products.map((p) => p.barcode ?? ""))); nameRef.current?.focus(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const save = async (another: boolean) => {
    if (saving) return;
    setTouched(true);
    if (!valid) { toast.error(Object.values(check)[0] ?? "Check the highlighted fields."); return; }
    setSaving(true);
    try {
      await saveProduct(f, custom, product, today);
      toast.success(isNew ? `${f.name.trim()} added.` : "Product saved.");
      if (another) {
        // Keep what a run of similar products shares; clear what is unique to each.
        setF({ ...blankProduct, category: f.category, unit: f.unit, warehouse: f.warehouse, supplier_id: f.supplier_id });
        setCustom([]);
        setTouched(false);
        setProducts(await erp.products({ fresh: true }).catch(() => products));
        codeRef.current?.focus();
      } else nav("/inventory");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const printLabels = () => {
    try { localStorage.setItem(LABEL_KEY, JSON.stringify(label)); } catch { /* the choice just isn't remembered */ }
    printHtml(labelSheetHtml([{ name: f.name.trim() || "Product", code: f.barcode, sku: f.sku.trim(), price: f.unit_price > 0 ? money(f.unit_price, ccy) : "" }], label.size, label.copies))
      .catch((e) => toast.error(errMsg(e)));
  };

  const num = (k: "unit_price" | "cost_price" | "mrp" | "quantity" | "reorder_level" | "obMrp", aria: string, readOnly = false) =>
    <input aria-label={aria} type="number" min="0" step="any" inputMode="decimal" className="input tabular-nums" placeholder="0" readOnly={readOnly}
      value={f[k] || ""} onChange={(e) => set(k, numInput(e.target.value))} />;

  if (loading) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (missing) return <div className="card mx-auto mt-10 max-w-md text-center">
    <p className="font-medium text-ink">This product no longer exists.</p>
    <Link className="btn-ghost mt-3 inline-flex" to="/inventory"><ArrowLeft size={14} /> Back to Inventory</Link>
  </div>;

  const ready: [string, boolean][] = [
    ["Name and SKU", !!f.name.trim() && !!f.sku.trim()],
    ["Selling price", f.unit_price > 0],
    ["Printable barcode", !!svg],
    ["Stock or reorder level", f.quantity > 0 || f.reorder_level > 0],
  ];

  return <div className="pb-24">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Link to="/inventory" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Inventory</Link>
        <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">{isNew ? "New product" : f.name || "Product"}</h1>
        <p className="text-sm text-muted-foreground">{isNew ? "Start with the barcode: scan it, type it, or let Filey make one." : `SKU ${product?.sku} · ${product?.quantity ?? 0} in stock`}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link className="btn-ghost" to="/inventory">Cancel</Link>
        {isNew && <button type="button" className="btn-ghost" disabled={saving} onClick={() => { void save(true); }}>Save and add another</button>}
        <button type="button" className="btn-primary" disabled={saving} onClick={() => { void save(false); }} title="Ctrl+S">{saving ? "Saving…" : isNew ? "Save product" : "Save changes"}</button>
      </div>
    </div>

    <fieldset disabled={saving} className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Step n={1} title="Barcode" hint="Point a USB scanner at this box and scan, use the camera, or generate an in-store code.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input ref={codeRef} autoFocus={isNew} aria-label="Barcode" className={cn("input h-14 pl-12 font-mono text-lg tracking-[0.18em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal", touched && check.barcode && "border-danger")}
                placeholder="Scan or type the barcode" value={f.barcode} inputMode="numeric" autoComplete="off" spellCheck={false}
                onChange={(e) => set("barcode", e.target.value.replace(/\s+/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); nameRef.current?.focus(); } }} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button type="button" className="btn-ghost h-12 shrink-0 sm:h-14" onClick={() => setScan(true)}><Camera size={16} /> Camera</button>
              <button type="button" className="btn-ghost h-12 shrink-0 sm:h-14" onClick={generate} title="Make a new in-store EAN-13 that no other product uses"><Sparkles size={16} /> Generate</button>
            </div>
          </div>
          <div className="mt-2 min-h-5 text-xs" aria-live="polite">
            {clash ? <span className="text-danger">Already used by <Link className="font-medium underline" to={`/inventory/${clash.id}`}>{clash.name}</Link>. Open it, or use another code.</span>
              : kind === "ean13" ? <span className="text-success"><Check size={12} className="mr-1 inline" />EAN-13, check digit correct{f.barcode.startsWith("2") ? " · in-store code" : ""}</span>
              : kind === "upca" ? <span className="text-success"><Check size={12} className="mr-1 inline" />UPC-A, check digit correct</span>
              : kind === "bad-check" ? <span className="text-warning"><AlertTriangle size={12} className="mr-1 inline" />The last digit should be {expectedCheckDigit(f.barcode)}. Check the number, or keep it if your supplier printed it this way.</span>
              : kind === "other" ? <span className="text-muted-foreground">Custom code: scanning works, but only EAN-13 and UPC-A print as labels here.</span>
              : <span className="text-muted-foreground">No barcode yet. Products without one can still be found by name at the counter.</span>}
          </div>
        </Step>

        <Step n={2} title="What it is">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name *" error={touched ? check.name : undefined} className="sm:col-span-2">
              <input ref={nameRef} aria-label="Name" className={cn("input h-12 text-base", touched && check.name && "border-danger")} placeholder="e.g. Paracetamol 500mg, 10 tablets"
                value={f.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="SKU *" error={touched ? check.sku : undefined}>
              <div className="flex gap-2">
                <input aria-label="SKU" className={cn("input font-mono", touched && check.sku && "border-danger")} value={f.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} />
                <button type="button" className="btn-ghost shrink-0" disabled={!f.name.trim()} onClick={() => set("sku", skuFromName(f.name, others.map((p) => p.sku)))}>From name</button>
              </div>
            </Field>
            <Field label="Category">
              <input aria-label="Category" className="input" list="product-categories" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Type or pick" />
              <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            {categories.length > 0 && !f.category && <div className="flex flex-wrap gap-1.5 sm:col-span-2">
              {categories.slice(0, 8).map((c) => <button key={c} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-hover" onClick={() => set("category", c)}>{c}</button>)}
            </div>}
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sold by</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Unit">
                {UNITS.map((u) => <button key={u} type="button" role="radio" aria-checked={f.unit === u}
                  className={cn("rounded-full border px-3 py-1 text-xs", f.unit === u ? "border-foreground bg-foreground text-background" : "border-border hover:bg-hover")}
                  onClick={() => set("unit", f.unit === u ? "" : u)}>{u}</button>)}
                <input aria-label="Other unit" className="input h-7 w-28 text-xs" placeholder="Other…" value={UNITS.includes(f.unit) ? "" : f.unit} onChange={(e) => set("unit", e.target.value)} />
              </div>
            </div>
            <Field label="Description" className="sm:col-span-2">
              <textarea aria-label="Description" className="input min-h-20" value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </div>
        </Step>

        <Step n={3} title="Price" hint="Counter prices include tax.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={`Selling price (${ccy})`}>{num("unit_price", "Selling price")}</Field>
            <Field label={`Cost price (${ccy})`}>{num("cost_price", "Cost price")}</Field>
            <Field label={`MRP (${ccy})`}>{num("mrp", "MRP")}</Field>
            <Field label="Tax code (HSN / SAC)"><input aria-label="Tax code" className="input" value={f.hsn} onChange={(e) => set("hsn", e.target.value)} /></Field>
          </div>
          {margin !== null && <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Profit per {f.unit || "unit"}: <b className="text-foreground">{money(f.unit_price - f.cost_price, ccy)}</b></span>
              <span className={cn("font-semibold tabular-nums", margin < 0 ? "text-danger" : margin < 10 ? "text-warning" : "text-success")}>{margin.toFixed(1)}% margin</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className={cn("h-full rounded-full", margin < 0 ? "bg-danger" : margin < 10 ? "bg-warning" : "bg-success")} style={{ width: `${Math.max(2, Math.min(100, Math.abs(margin)))}%` }} />
            </div>
            {f.mrp > 0 && f.unit_price > f.mrp && <p className="mt-1 text-[11px] text-danger">Selling price is above the MRP.</p>}
          </div>}
        </Step>

        <Step n={4} title="Stock" hint={isNew ? "What you have now. Later changes go through Stocktake or Batches." : "Change stock with Stocktake or Batches in Inventory."}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label={isNew ? "Opening quantity" : "In stock"}>{num("quantity", "Quantity", !isNew)}</Field>
            <Field label="Reorder at">{num("reorder_level", "Reorder level")}</Field>
            <Field label="Location" className="col-span-2 md:col-span-1"><input aria-label="Warehouse" className="input" placeholder="Main warehouse, shelf A3" value={f.warehouse} onChange={(e) => set("warehouse", e.target.value)} /></Field>
          </div>
        </Step>

        <Step n={5} title="Batch and expiry" hint={isNew ? "Optional. For goods that expire: the counter sells the batch that expires first." : undefined}
          aside={!isNew && product ? <button type="button" className="btn-ghost" onClick={() => setBatchesOpen(true)}><Layers size={14} /> {batches.length ? "Manage batches" : "Track by batch"}</button> : undefined}>
          {isNew ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Batch no."><input aria-label="Opening batch number" className="input font-mono" value={f.obNo} onChange={(e) => set("obNo", e.target.value.toUpperCase())} /></Field>
            <Field label="Expiry" error={touched ? check.batch : undefined}><input aria-label="Opening batch expiry" className="input" placeholder="MM/YY" value={f.obExp} onChange={(e) => set("obExp", e.target.value)} /></Field>
            <Field label="Made on"><DateField value={f.obMfg} onChange={(v) => set("obMfg", v)} /></Field>
            <Field label={`Batch MRP (${ccy})`}>{num("obMrp", "Opening batch MRP")}</Field>
          </div> : batches.length ? <ul className="divide-y divide-border rounded-xl border border-border text-sm">{batches.slice(0, 6).map((b) =>
            <li key={`${b.no}-${b.exp}`} className="flex justify-between gap-2 px-3 py-2">
              <span className="truncate font-mono">{b.no}</span>
              <span className={cn("shrink-0 tabular-nums", b.expired ? "text-danger" : b.daysLeft <= 90 ? "text-warning" : "text-muted-foreground")}>{b.left} left · exp {fmtDate(b.exp)}</span>
            </li>)}</ul>
            : <div className="grid grid-cols-2 gap-3">
              <Field label="Batch / lot"><input aria-label="Batch number" className="input font-mono" value={f.batch_number} onChange={(e) => set("batch_number", e.target.value)} /></Field>
              <Field label="Expiry date"><DateField value={f.expiry_date} onChange={(v) => set("expiry_date", v)} /></Field>
            </div>}
        </Step>

        <Step n={6} title="More details" hint="Supplier, purchase date and your own fields.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier">
              <select aria-label="Supplier" className="input" value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
                <option value="">None</option>{vendors.map((v) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Date of purchase"><DateField value={f.purchase_date} onChange={(v) => set("purchase_date", v)} /></Field>
          </div>
          <div className="mt-4 space-y-2">
            {custom.map((c, i) => <div key={i} className="flex items-center gap-2">
              <input className="input flex-1" placeholder="Field, e.g. Colour" aria-label={`Custom field ${i + 1} name`} value={c.key} onChange={(e) => setCustom((cs) => cs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <input className="input flex-1" placeholder="Value" aria-label={`Custom field ${i + 1} value`} value={c.value} onChange={(e) => setCustom((cs) => cs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" aria-label="Remove field" className="btn-ghost w-10 shrink-0 !px-0 text-danger" onClick={() => setCustom((cs) => cs.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>)}
            <button type="button" className="btn-ghost" onClick={() => setCustom((c) => [...c, { key: "", value: "" }])}><Plus size={13} /> Add a field</button>
          </div>
        </Step>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:h-fit">
        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">At the counter</p>
          <div className="flex items-center gap-3 rounded-xl border border-border p-3">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl text-lg font-semibold text-white" style={{ background: `hsl(${hue(f.name || "?")} 55% 45%)` }} aria-hidden="true">
              {(f.name.trim() || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{f.name.trim() || "Product name"}</p>
              <p className="truncate text-xs text-muted-foreground">{[f.category, f.unit && `per ${f.unit}`].filter(Boolean).join(" · ") || "Category"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums text-foreground">{money(f.unit_price || 0, ccy)}</span>
                <span className="text-xs text-muted-foreground">· {f.quantity || 0} in stock</span>
                {low && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">Low stock</span>}
                {daysToExpiry !== null && daysToExpiry < 0 && <span className="rounded-full bg-danger/15 px-1.5 text-[10px] font-medium text-danger">Expired</span>}
                {daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 90 && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">Expires in {daysToExpiry} d</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Barcode label</p>
          {/* Label paper stays white in dark mode: index.css darkens a bare bg-white. */}
          <div className="rounded-xl border border-border bg-[#fff] p-3 text-[#000]">
            <p className="truncate text-xs font-semibold">{f.name.trim() || "Product name"}</p>
            {svg ? <div className="my-1 [&_svg]:h-auto [&_svg]:w-full" data-barcode-preview dangerouslySetInnerHTML={{ __html: svg }} />
              : <div className="my-1 grid h-16 place-items-center rounded border border-dashed border-[#d4d4d4] text-[11px] text-[#737373]">{f.barcode ? "This code type does not print" : "Scan or generate a barcode"}</div>}
            <div className="flex justify-between text-[10px]"><span className="font-mono">{f.sku}</span><b>{f.unit_price > 0 ? money(f.unit_price, ccy) : ""}</b></div>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_88px] gap-2">
            <select aria-label="Label size" className="input" value={label.size} onChange={(e) => setLabel({ ...label, size: e.target.value as LabelSize })}>
              <option value="50x25">Label roll 50 × 25 mm</option>
              <option value="38x25">Label roll 38 × 25 mm</option>
              <option value="a4">A4 sheet, 3 × 8</option>
            </select>
            <input aria-label="Copies" type="number" min="1" max="500" className="input" value={label.copies} onChange={(e) => setLabel({ ...label, copies: Math.max(1, Math.min(500, Math.floor(numInput(e.target.value)) || 1)) })} />
          </div>
          <button type="button" className="btn-ghost mt-2 w-full" disabled={!svg} onClick={printLabels}><Printer size={15} /> Print {label.copies} label{label.copies === 1 ? "" : "s"}</button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ready to sell</p>
          <ul className="space-y-1.5 text-sm">{ready.map(([text, ok]) =>
            <li key={text} className="flex items-center gap-2"><span className={cn("grid h-4 w-4 place-items-center rounded-full", ok ? "bg-success text-white" : "border border-border")}>{ok && <Check size={10} />}</span>
              <span className={ok ? "text-foreground" : "text-muted-foreground"}>{text}</span></li>)}</ul>
        </section>
      </aside>
    </fieldset>

    <BarcodeScanner open={scan} onClose={() => setScan(false)} title="Scan the product's barcode"
      onScan={(code) => { setScan(false); set("barcode", code.trim()); nameRef.current?.focus(); }} />
    {product && batchesOpen && <BatchesModal product={product} onClose={() => setBatchesOpen(false)} onSaved={() => { void load(); }} />}
  </div>;
}
