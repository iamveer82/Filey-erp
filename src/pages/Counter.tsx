import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Minus, Pause, Plus, Printer, ScanLine, Search, Trash2 } from "lucide-react";
import { billing, crm, erp, type CompanyProfile, type CrmCustomer, type InvoiceDocSummary, type InvoicePayment, type Product } from "../lib/api";
import { fmtDate, getDisplayCurrency, money, numInput, todayYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import { useAuth } from "../lib/auth";
import { useModules } from "../lib/modules";
import { useLiveSync } from "../lib/realtime";
import { companyCountry } from "../lib/companyCountry";
import { Badge, PageHeader } from "../components/ui";
import BarcodeScanner from "../components/BarcodeScanner";
import BatchesModal from "../components/BatchesModal";
import { expiringBatches } from "../lib/batches";
import {
  cartTotal, counterMethods, findProducts, hasBatches, heldBills, isCounterSale, lineFor, lowStock, saveHeldBills, sellAtCounter, sellable,
  type CartLine, type HeldBill,
} from "../lib/counter";
import { printSavedReceipt, receiptPrefs, saveReceiptPrefs, type ReceiptPrefs, type ReceiptWidth } from "../lib/receipt";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The sales counter for any shop: scan or search, bill, take payment, print the receipt.
 *  Pharma mode calls it Pharmacy and adds the patient and doctor. */
export default function Counter() {
  const { pharmaMode } = useModules();
  const [tab, setTab] = useState<"bill" | "sales">("bill");
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  useEffect(() => { billing.getCompany().then(setCompany).catch(() => setCompany(null)); }, []);
  const india = !!company && companyCountry(company) === "IN";
  const title = pharmaMode ? "Pharmacy" : "Counter";

  return <div>
    <PageHeader title={title}
      subtitle={pharmaMode ? "Counter sales from the batch that expires first, with stock and expiry in view" : "Quick sales at the till: scan, bill, take payment and print the receipt"}
      action={<div className="flex flex-wrap gap-2" role="tablist" aria-label={`${title} views`}>
        {(["bill", "sales"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t}
          className={tab === t ? "btn-primary" : "btn-ghost"} onClick={() => setTab(t)}>{t === "bill" ? "Bill" : "Sales history"}</button>)}
        <Link className="btn-ghost" to="/inventory">Inventory</Link>
      </div>} />
    {tab === "bill" ? <BillView pharma={pharmaMode} india={india} /> : <SalesHistory india={india} />}
  </div>;
}

function BillView({ pharma, india }: { pharma: boolean; india: boolean }) {
  const { toast } = useUI();
  const today = todayYmd();
  const ccy = getDisplayCurrency();
  const m = (v: number) => money(v, ccy);
  const methods = counterMethods(india);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [todaySales, setTodaySales] = useState<InvoiceDocSummary[]>([]);
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [patient, setPatient] = useState("");
  const [doctor, setDoctor] = useState("");
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: number; number: string; total: number; tendered: number; change: number } | null>(null);
  const [held, setHeld] = useState<HeldBill[]>(() => heldBills());
  const [scan, setScan] = useState(false);
  const [batchesFor, setBatchesFor] = useState<Product | null>(null);
  const [prefs, setPrefs] = useState<ReceiptPrefs>(() => receiptPrefs());
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    erp.products({ fresh: true }).then(setProducts).catch((e) => toast.error(errMsg(e)));
    billing.listDocs("sales").then((docs) => setTodaySales(docs.filter((d) => isCounterSale(d) && d.issue_date === todayYmd() && d.status !== "draft"))).catch(() => {});
    // toast is recreated each render; loading must not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  useEffect(() => { crm.customers().then(setCustomers).catch(() => setCustomers([])); }, []);
  useLiveSync(load, ["products", "invoice_docs"]);
  // UPI is offered in India only; anywhere else the till falls back to cash.
  useEffect(() => { if (!india && method === "upi") setMethod("cash"); }, [india, method]);

  const results = useMemo(() => findProducts(products, q), [products, q]);
  const expiring = useMemo(() => expiringBatches(products, today, 90), [products, today]);
  const low = useMemo(() => lowStock(products), [products]);
  const savedCustomer = customers.find((c) => c.name.trim().toLowerCase() === customer.trim().toLowerCase() && customer.trim());
  const total = cartTotal(lines);
  const change = method === "cash" && tendered > total ? r2(tendered - total) : 0;

  const add = (p: Product) => {
    try {
      const line = lineFor(p, today);
      if (line.batch) {
        const inCart = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
        if (inCart + 1 > sellable(p, today)) throw new Error(`Only ${sellable(p, today)} of ${p.name} can be sold.`);
      }
      const at = lines.findIndex((l) => l.productId === p.id && l.batch === line.batch);
      setLines(at >= 0 ? lines.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l)) : [...lines, line]);
      setDone(null);
      setQ("");
      search.current?.focus();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const setLine = (i: number, patch: Partial<CartLine>) => setLines(lines.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const clear = () => { setLines([]); setCustomer(""); setPatient(""); setDoctor(""); setTendered(0); };

  const hold = () => {
    if (!lines.length) return;
    const next = [{ id: crypto.randomUUID(), label: customer.trim() || patient.trim() || `Bill ${held.length + 1}`, at: new Date().toISOString(), lines, customer, patient, doctor }, ...held];
    setHeld(next); saveHeldBills(next); clear();
    toast.success("Bill on hold.");
  };
  const resume = (b: HeldBill) => {
    const next = held.filter((x) => x.id !== b.id);
    if (lines.length) next.unshift({ id: crypto.randomUUID(), label: customer.trim() || `Bill ${next.length + 1}`, at: new Date().toISOString(), lines, customer, patient, doctor });
    setLines(b.lines); setCustomer(b.customer ?? ""); setPatient(b.patient ?? ""); setDoctor(b.doctor ?? "");
    setHeld(next); saveHeldBills(next);
  };

  const print = (id: number, cash?: { tendered?: number; change?: number }) =>
    printSavedReceipt(id, cash).catch((e) => toast.error(`Could not print the receipt: ${errMsg(e)}`));
  const setPref = (patch: Partial<ReceiptPrefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); saveReceiptPrefs(next); };

  const charge = async () => {
    if (!lines.length || busy) return;
    if (method === "cash" && tendered > 0 && tendered < total) { toast.error(`Cash given is less than ${m(total)}.`); return; }
    setBusy(true);
    try {
      const sale = await sellAtCounter({ lines, method, customer: customer.trim(), customerId: savedCustomer?.id,
        ...(pharma ? { patient, doctor } : {}), today });
      const cash = method === "cash" && tendered > 0 ? { tendered, change: r2(tendered - sale.total) } : { tendered: 0, change: 0 };
      setDone({ ...sale, ...cash });
      clear();
      load();
      if (prefs.auto) void print(sale.id, cash);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); search.current?.focus(); }
  };

  const takings = todaySales.reduce((s, d) => s + (Number(d.total) || 0), 0);
  const noun = pharma ? "medicine" : "item";

  return <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input ref={search} autoFocus aria-label={pharma ? "Find a medicine" : "Find an item"} className="input h-11 pl-9" placeholder={`${pharma ? "Medicine" : "Item"} name, barcode, SKU or batch, then Enter`}
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results.length >= 1 && (results.length === 1 || results[0].barcode === q.trim() || results[0].sku === q.trim())) { e.preventDefault(); add(results[0]); } }} />
          </div>
          <button type="button" className="btn-ghost h-11" onClick={() => setScan(true)}><ScanLine size={15} /> Scan</button>
        </div>

        {q.trim() ? <div className="overflow-hidden rounded-xl border border-border bg-card">
          {results.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No {noun} matches “{q.trim()}”.</p> :
            results.map((p) => {
              const next = expiringBatches([p], today, 99999).find((x) => !x.batch.expired);
              const can = sellable(p, today);
              const blocked = hasBatches(p) && can <= 0;
              return <button key={p.id} type="button" onClick={() => add(p)} disabled={blocked}
                className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-hover disabled:opacity-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.sku, p.category, next && `Batch ${next.batch.no} · exp ${fmtDate(next.batch.exp)}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums text-ink">{m(Number(next?.batch.mrp) || p.unit_price)}</span>
                  <span className={`block text-xs ${blocked ? "text-danger" : "text-muted-foreground"}`}>{blocked ? "Not sellable" : `${can} in stock`}</span>
                </span>
              </button>;
            })}
        </div> : <>
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-card p-4">
            {[["Bills today", String(todaySales.length)], ["Takings today", m(takings)], ["Expiring ≤ 90 days", String(expiring.length)]].map(([k, v]) =>
              <div key={k}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums text-foreground">{v}</p></div>)}
          </div>
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle size={14} className="text-warning" /> Expiring soon</h2>
            {expiring.length === 0 ? <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">Nothing expires in the next 90 days. Products get batches and expiry dates under Inventory → Batches.</p> :
              <div className="overflow-hidden rounded-xl border border-border bg-card">{expiring.slice(0, 12).map(({ product: p, batch: b }) =>
                <button key={`${p.id}-${b.no}`} type="button" onClick={() => setBatchesFor(p)} className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left text-sm last:border-0 hover:bg-hover">
                  <span className="min-w-0 truncate"><span className="font-medium text-ink">{p.name}</span> <span className="text-muted-foreground">· batch {b.no} · {b.left} left</span></span>
                  {b.expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="warn">{b.daysLeft} days</Badge>}
                </button>)}</div>}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Low stock</h2>
            {low.length === 0 ? <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">Everything is above its reorder level.</p> :
              <div className="overflow-hidden rounded-xl border border-border bg-card">{low.slice(0, 12).map((p) =>
                <div key={p.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0">
                  <span className="truncate font-medium text-ink">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.quantity} left · reorder at {p.reorder_level}</span>
                </div>)}</div>}
          </section>
        </>}
      </div>

      <aside className="h-fit rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Bill</h2>
          {held.length > 0 && <span className="text-xs text-muted-foreground">{held.length} on hold</span>}
        </div>
        {held.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{held.map((b) =>
          <button key={b.id} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-hover" onClick={() => resume(b)} title={`Held ${new Date(b.at).toLocaleTimeString()}`}>
            {b.label} · {m(cartTotal(b.lines))}</button>)}</div>}

        {done && <div role="status" className="mb-3 space-y-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
          <p>Paid {m(done.total)}{done.change > 0 ? ` · change ${m(done.change)}` : ""}. Receipt {done.number}.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => { void print(done.id, done.tendered ? done : undefined); }}><Printer size={15} /> Print receipt</button>
            <Link className="text-xs underline" to={`/invoicing?open=${done.id}`}>Open as invoice</Link>
          </div>
        </div>}

        {lines.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Scan or search to add {noun}s.</p> :
          <ul className="mb-3 divide-y divide-border">{lines.map((l, i) =>
            <li key={`${l.productId}-${l.batch ?? ""}`} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{l.name}</p>
                  {l.batch && <p className="text-[11px] text-muted-foreground">Batch {l.batch} · exp {l.exp?.slice(0, 7)}</p>}</div>
                <button type="button" aria-label={`Remove ${l.name}`} className="text-muted-foreground hover:text-danger" onClick={() => setLines(lines.filter((_, x) => x !== i))}><Trash2 size={14} /></button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button type="button" aria-label={`One less ${l.name}`} className="btn-ghost h-8 w-8 p-0" onClick={() => setLine(i, { qty: Math.max(1, l.qty - 1) })}><Minus size={13} /></button>
                <input aria-label={`Quantity of ${l.name}`} type="number" min="1" className="input h-8 w-16 text-center" value={l.qty || ""} onChange={(e) => setLine(i, { qty: numInput(e.target.value) })} />
                <button type="button" aria-label={`One more ${l.name}`} className="btn-ghost h-8 w-8 p-0" onClick={() => { const p = products.find((x) => x.id === l.productId); if (p) add(p); }}><Plus size={13} /></button>
                <input aria-label={`Price of ${l.name}`} type="number" min="0" step="any" className="input h-8 w-24 text-right" value={l.price || ""} onChange={(e) => setLine(i, { price: numInput(e.target.value) })} />
                <span className="ml-auto text-sm font-semibold tabular-nums text-ink">{m(l.qty * l.price)}</span>
              </div>
            </li>)}</ul>}

        <div className="space-y-2">
          <input aria-label="Customer" className="input" list="counter-customers" placeholder="Customer (pick a saved one, or walk-in if blank)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <datalist id="counter-customers">{customers.slice(0, 500).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          {savedCustomer && <p className="text-[11px] text-success">Saved customer: the sale goes on {savedCustomer.name}'s account.</p>}
          {pharma && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Prescription details</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input aria-label="Patient" className="input" placeholder="Patient" value={patient} onChange={(e) => setPatient(e.target.value)} />
              <input aria-label="Doctor" className="input" placeholder="Doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)} />
            </div>
          </details>}
        </div>

        <div className="my-4 flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">Total (tax included)</span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{m(total)}</span>
        </div>
        <div className={`mb-3 grid gap-1.5 ${methods.length === 4 ? "grid-cols-2" : "grid-cols-3"}`} role="radiogroup" aria-label="Payment method">
          {methods.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={method === v}
            className={`rounded-xl border px-3 py-2 text-sm ${method === v ? "border-primary bg-primary/10 font-medium text-ink" : "border-border hover:bg-hover"}`} onClick={() => setMethod(v)}>{label}</button>)}
        </div>
        {method === "cash" && <div className="mb-3 flex items-center gap-2">
          <input aria-label="Cash given" type="number" min="0" className="input" placeholder="Cash given" value={tendered || ""} onChange={(e) => setTendered(numInput(e.target.value))} />
          <span className="shrink-0 text-sm text-muted-foreground">Change <span className="font-semibold tabular-nums text-ink">{m(change)}</span></span>
        </div>}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" disabled={!lines.length || busy} onClick={hold} title="Keep this bill aside and start another"><Pause size={14} /> Hold</button>
          <button type="button" className="btn-ghost" disabled={!lines.length || busy} onClick={clear}>Clear</button>
          <button type="button" className="btn-primary ml-auto" disabled={!lines.length || busy} onClick={() => { void charge(); }}>{busy ? "Saving…" : `Charge ${m(total)}`}</button>
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Receipt printer</summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">Size
              <select aria-label="Receipt size" className="input h-8 w-auto" value={prefs.width} onChange={(e) => setPref({ width: e.target.value as ReceiptWidth })}>
                <option value="80mm">80 mm till roll</option><option value="58mm">58 mm till roll</option><option value="a4">A4 page</option>
              </select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.auto} onChange={(e) => setPref({ auto: e.target.checked })} /> Print after every sale</label>
          </div>
          <p className="mt-1">Saved on this device only.</p>
        </details>
      </aside>
    </div>

    <BarcodeScanner open={scan} onClose={() => setScan(false)} title="Scan a barcode"
      onScan={(code) => { setScan(false); const hit = findProducts(products, code); if (hit.length === 1) add(hit[0]); else { setQ(code); toast.info(`No single match for ${code}.`); } }} />
    <BatchesModal product={batchesFor ? products.find((p) => p.id === batchesFor.id) ?? batchesFor : null} onClose={() => setBatchesFor(null)} onSaved={load} />
  </>;
}

const methodLabel = (m?: string | null) => ({ cash: "Cash", card: "Card", upi: "UPI", "bank transfer": "Bank transfer" } as Record<string, string>)[(m ?? "").toLowerCase()] ?? (m || "Other");

/** Past counter receipts with PharmaSpot-style filters: dates, payment method and cashier. */
function SalesHistory({ india }: { india: boolean }) {
  const { toast } = useUI();
  const { user } = useAuth();
  const ccy = getDisplayCurrency();
  const m = (v: number) => money(v, ccy);
  const today = todayYmd();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [method, setMethod] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<InvoiceDocSummary[]>([]);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([billing.listDocs("sales"), billing.allPayments().catch(() => [] as InvoicePayment[])])
      .then(([list, pays]) => { setDocs(list.filter((d) => isCounterSale(d) && d.status !== "draft")); setPayments(pays); })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
    // toast is recreated each render; loading must not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  useLiveSync(load, ["invoice_docs", "invoice_payments"]);

  const paysBy = useMemo(() => {
    const map = new Map<number, InvoicePayment[]>();
    for (const p of payments) map.set(Number(p.invoice_id), [...(map.get(Number(p.invoice_id)) ?? []), p]);
    return map;
  }, [payments]);
  const rows = docs.filter((d) => {
    const date = d.issue_date ?? "";
    if ((from && date < from) || (to && date > to)) return false;
    if (mine && user?.id && d.user_id && d.user_id !== user.id) return false;
    if (method && !(paysBy.get(d.id) ?? []).some((p) => (p.method ?? "").toLowerCase() === method)) return false;
    const s = q.trim().toLowerCase();
    return !s || d.number.toLowerCase().includes(s) || (d.customer_name ?? "").toLowerCase().includes(s);
  }).sort((a, b) => (b.issue_date ?? "").localeCompare(a.issue_date ?? "") || b.id - a.id);
  const total = r2(rows.reduce((s, d) => s + (Number(d.total) || 0), 0));
  const byMethod = new Map<string, number>();
  for (const d of rows) for (const p of paysBy.get(d.id) ?? []) byMethod.set(methodLabel(p.method), r2((byMethod.get(methodLabel(p.method)) ?? 0) + Number(p.amount || 0)));
  const methodOptions = counterMethods(india);

  return <div>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-xs">From<input aria-label="From date" type="date" className="input mt-1 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="text-xs">To<input aria-label="To date" type="date" className="input mt-1 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label className="text-xs">Paid by<select aria-label="Paid by" className="input mt-1 w-40" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="">Any method</option>{methodOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      {user?.id && <label className="text-xs">Cashier<select aria-label="Cashier" className="input mt-1 w-40" value={mine ? "me" : "all"} onChange={(e) => setMine(e.target.value === "me")}>
        <option value="all">Everyone</option><option value="me">Only me</option></select></label>}
      <label className="min-w-[12rem] flex-1 text-xs">Search<input aria-label="Search receipts" className="input mt-1" placeholder="Receipt no. or customer" value={q} onChange={(e) => setQ(e.target.value)} /></label>
    </div>
    {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading sales…</p> : rows.length === 0
      ? <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No counter sales in this period.</p>
      : <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Receipt</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Paid by</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id} className="border-b border-border last:border-0">
            <td className="px-3 py-2 font-medium text-ink">{d.number}</td>
            <td className="px-3 py-2">{fmtDate(d.issue_date)}</td>
            <td className="px-3 py-2">{d.customer_name}</td>
            <td className="px-3 py-2">{[...new Set((paysBy.get(d.id) ?? []).map((p) => methodLabel(p.method)))].join(", ") || "—"}</td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{m(Number(d.total) || 0)}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              <button type="button" className="btn-ghost h-8 text-xs" aria-label={`Print ${d.number}`} onClick={() => { void printSavedReceipt(d.id).catch((e) => toast.error(errMsg(e))); }}><Printer size={13} /> Print</button>
              <Link className="btn-ghost h-8 text-xs" to={`/invoicing?open=${d.id}`}>Open</Link>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
    {rows.length > 0 && <p className="mt-3 text-sm text-muted-foreground">
      {rows.length} receipt{rows.length === 1 ? "" : "s"} · total <span className="font-semibold text-ink">{m(total)}</span>
      {[...byMethod].map(([k, v]) => <span key={k}> · {k} {m(v)}</span>)}
    </p>}
  </div>;
}
