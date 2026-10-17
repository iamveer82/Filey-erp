/* Filey AI's generative UI, after OpenIntelligentUI (github.com/CopilotKit/
 * OpenIntelligentUI, MIT): interactive cards (show_ui, run in the sandboxed card
 * origin, see src-tauri/src/modules/genui.*), native widgets (show_view: charts,
 * tables, stats, steps, choices), saved design-card templates, the starter
 * gallery, and pictures for cards (generated, from My Files, or attributed
 * Wikimedia photos). */

export interface GenUiImage {
  /** What the card calls it: <img data-filey-image="name"> or filey.image("name"). */
  name: string;
  /** "media:<job id>" (a generated image), "file:<My Files name>" or an upload.wikimedia.org URL. */
  source: string;
}

export interface GenUiCardSpec {
  kind?: "card";
  title?: string;
  initialHeight?: number;
  placeholderMessages?: string[];
  css?: string;
  html: string;
  jsFunctions?: string;
  jsExpressions?: string[];
  /** Filey's first card version: one script run after the html. */
  js?: string;
  images?: GenUiImage[];
}

/** Vivid categorical colours for widgets and cards (genui.html mirrors them as --chart-1..8). */
export const GEN_UI_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#84cc16"];

export type ViewKind = "bar" | "line" | "area" | "pie" | "radial" | "table" | "stats" | "steps" | "choices";
export const VIEW_KINDS: ViewKind[] = ["bar", "line", "area", "pie", "radial", "table", "stats", "steps", "choices"];

export interface GenUiViewSpec {
  kind: "view";
  view: ViewKind;
  title?: string;
  /** Charts: x-axis labels (pie: slice labels). */
  labels?: string[];
  /** bar/line/area: one or more named series aligned with labels. */
  series?: { name: string; values: number[] }[];
  /** pie / radial: one value per label. */
  values?: number[];
  /** bar: stack the series (parts of one total) instead of side by side. */
  stacked?: boolean;
  /** radial: the words under the centre total. */
  center?: string;
  unit?: string;
  columns?: string[];
  rows?: (string | number | null)[][];
  items?: { label?: string; title?: string; value?: string | number; change?: string; tone?: "good" | "bad" | "neutral"; detail?: string; status?: "done" | "doing" | "todo" }[];
  question?: string;
  options?: string[];
}

export type GenUiItem = GenUiCardSpec | GenUiViewSpec;

const text = (v: unknown, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const texts = (v: unknown, max = 200, each = 2_000) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map(x => x.slice(0, each)) : undefined;
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

/** A show_ui call's arguments as a card, or why not. */
export function cardFromArgs(a: Record<string, unknown>): GenUiCardSpec | string {
  const html = text(a.html);
  if (!html?.trim()) return "Give the card's html.";
  const card: GenUiCardSpec = {
    title: text(a.title, 120),
    initialHeight: Number.isFinite(Number(a.initialHeight)) ? Math.min(Math.max(Number(a.initialHeight), 60), 1600) : undefined,
    placeholderMessages: texts(a.placeholderMessages, 4, 80),
    css: text(a.css),
    html,
    jsFunctions: text(a.jsFunctions),
    jsExpressions: texts(a.jsExpressions, 50, 20_000),
    js: text(a.js),
    images: Array.isArray(a.images)
      ? (a.images as Record<string, unknown>[]).flatMap(i => {
          const name = text(i?.name, 60)?.trim(), source = text(i?.source, 2_000)?.trim();
          return name && source ? [{ name, source }] : [];
        }).slice(0, 12)
      : undefined,
  };
  const size = [card.css, card.html, card.jsFunctions, card.js, ...(card.jsExpressions ?? [])].reduce((n, s) => n + (s?.length ?? 0), 0);
  if (size > 160_000) return "Keep the card under 160 KB: less markup, data computed in code.";
  return card;
}

/** A show_view call's arguments as a native widget, or why not. */
export function viewFromArgs(a: Record<string, unknown>): GenUiViewSpec | string {
  const view = a.view as ViewKind;
  if (!VIEW_KINDS.includes(view)) return `view must be one of ${VIEW_KINDS.join(", ")}.`;
  const spec: GenUiViewSpec = { kind: "view", view, title: text(a.title, 120), unit: text(a.unit, 20),
    ...(a.stacked === true ? { stacked: true } : {}), ...(typeof a.center === "string" ? { center: a.center.slice(0, 60) } : {}) };
  if (view === "bar" || view === "line" || view === "area") {
    spec.labels = texts(a.labels, 200, 60);
    spec.series = Array.isArray(a.series)
      ? (a.series as Record<string, unknown>[]).slice(0, 6).map(s => ({
          name: text(s?.name, 60) ?? "Series",
          values: Array.isArray(s?.values) ? (s.values as unknown[]).slice(0, 200).map(finite) : [],
        }))
      : [];
    if (!spec.labels?.length || !spec.series.length) return "Give labels and at least one series of values.";
    if (spec.series.some(s => s.values.length !== spec.labels!.length || s.values.some(v => !Number.isFinite(v))))
      return "Every series needs one finite number per label.";
  } else if (view === "pie" || view === "radial") {
    spec.labels = texts(a.labels, view === "radial" ? 4 : 24, 60);
    spec.values = Array.isArray(a.values) ? (a.values as unknown[]).slice(0, 24).map(finite) : [];
    if (!spec.labels?.length || spec.values.length !== spec.labels.length || spec.values.some(v => !Number.isFinite(v) || v < 0))
      return "Give one label and one non-negative number per slice.";
  } else if (view === "table") {
    spec.columns = texts(a.columns, 20, 60);
    spec.rows = Array.isArray(a.rows)
      ? (a.rows as unknown[]).slice(0, 300).map(r => (Array.isArray(r) ? r.slice(0, 20).map(c => (typeof c === "number" || typeof c === "string" ? c : c == null ? null : String(c))) : []))
      : [];
    if (!spec.columns?.length) return "Give the table's columns.";
  } else if (view === "stats" || view === "steps") {
    spec.items = Array.isArray(a.items)
      ? (a.items as Record<string, unknown>[]).slice(0, 24).map(i => ({
          label: text(i?.label, 80), title: text(i?.title, 200), detail: text(i?.detail, 600), change: text(i?.change, 40),
          value: typeof i?.value === "number" ? i.value : text(i?.value, 60),
          tone: ["good", "bad", "neutral"].includes(i?.tone as string) ? (i.tone as "good") : undefined,
          status: ["done", "doing", "todo"].includes(i?.status as string) ? (i.status as "done") : undefined,
        }))
      : [];
    if (!spec.items.length) return "Give at least one item.";
  } else if (view === "choices") {
    spec.question = text(a.question, 300);
    spec.options = texts(a.options, 8, 200);
    if (!spec.options?.length) return "Give at least one option.";
  }
  return spec;
}

/* ---------------- Templates (OpenIntelligentUI's template library) ---------------- */

export interface CardTemplate {
  name: string;
  description: string;
  /** What to fill in when reusing it. */
  data?: string;
  card: Pick<GenUiCardSpec, "css" | "html" | "jsFunctions" | "jsExpressions" | "js" | "initialHeight">;
  builtIn?: boolean;
  savedAt?: number;
}

const TEMPLATE_KEY = "ai_card_templates";
const MAX_TEMPLATES = 60;

export const BUILT_IN_TEMPLATES: CardTemplate[] = [
  {
    name: "Invoice card",
    description: "Compact invoice summary: amount, customer, number, dates, status and actions.",
    data: "Invoice number, customer, amount and currency, issue and due dates, status (paid/unpaid/overdue), short description.",
    builtIn: true,
    card: {
      initialHeight: 220,
      css: `.inv{display:grid;gap:10px}.inv .top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.inv .amt{font-size:26px;font-weight:600;letter-spacing:-.02em}.badge{font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)}
.badge.paid{background:var(--color-background-success);color:var(--color-text-success)}.badge.overdue{background:var(--color-background-danger);color:var(--color-text-danger)}
.inv dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0;font-size:13px}.inv dt{color:var(--color-text-secondary)}.inv dd{margin:0}`,
      html: `<div class="inv card"><div class="top"><div><div class="muted" id="no">INV-0001</div><div class="amt" id="amount">AED 0.00</div></div><span class="badge" id="status">Unpaid</span></div>
<dl><dt>Customer</dt><dd id="customer">-</dd><dt>Issued</dt><dd id="issued">-</dd><dt>Due</dt><dd id="due">-</dd><dt>For</dt><dd id="desc">-</dd></dl>
<div class="row"><button class="primary" id="remind">Send a reminder</button><button id="open">Open invoice</button></div></div>`,
      jsFunctions: `const INVOICE = { no: "INV-0001", customer: "Customer", amount: "AED 1,050.00", issued: "1 Oct 2026", due: "31 Oct 2026", status: "unpaid", desc: "Services" };
function showInvoice(d) {
  for (const k of ["no", "customer", "amount", "issued", "due", "desc"]) document.getElementById(k).textContent = d[k];
  const s = document.getElementById("status"); s.textContent = d.status[0].toUpperCase() + d.status.slice(1); s.className = "badge " + d.status;
  document.getElementById("remind").onclick = () => filey.send("Draft a payment reminder for invoice " + d.no + " to " + d.customer + ".");
  document.getElementById("open").onclick = () => filey.send("Open invoice " + d.no + ".");
}`,
      jsExpressions: ["showInvoice(INVOICE)"],
    },
  },
  {
    name: "KPI dashboard",
    description: "KPI tiles with change badges and a monthly bar chart.",
    data: "Title, period, 3-4 KPIs (label, value, change), monthly labels and values.",
    builtIn: true,
    card: {
      initialHeight: 340,
      css: `.dash{display:grid;gap:12px}.kpis{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.kpi{padding:12px;border-radius:var(--border-radius-lg);background:var(--color-background-secondary)}.kpi b{display:block;font-size:20px;letter-spacing:-.01em}
.up{color:var(--color-text-success);font-size:12px}.down{color:var(--color-text-danger);font-size:12px}
.bars{display:flex;align-items:flex-end;gap:8px;height:140px;padding-top:8px}.bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:var(--color-text-secondary)}
.bar i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:var(--color-accent);opacity:.85;transition:height .5s ease-out}`,
      html: `<div class="dash"><div><h3 id="title">Dashboard</h3><div class="muted" id="period"></div></div><div class="kpis" id="kpis"></div><div class="bars" id="bars" role="img" aria-label="Monthly values"></div></div>`,
      jsFunctions: `const DASH = { title: "Sales", period: "Last 6 months", kpis: [{ label: "Revenue", value: "AED 120k", change: "+12%" }, { label: "Invoices", value: "48", change: "+4%" }, { label: "Overdue", value: "AED 8k", change: "-3%" }], months: ["May","Jun","Jul","Aug","Sep","Oct"], values: [14, 18, 16, 22, 25, 21] };
function showDash(d) {
  title.textContent = d.title; period.textContent = d.period;
  kpis.innerHTML = ""; for (const k of d.kpis) { const el = document.createElement("div"); el.className = "kpi"; const up = !String(k.change).startsWith("-");
    el.innerHTML = '<span class="muted"></span><b></b><span></span>'; el.children[0].textContent = k.label; el.children[1].textContent = k.value; el.children[2].textContent = k.change || ""; el.children[2].className = up ? "up" : "down"; kpis.append(el); }
  const max = Math.max(...d.values, 1); bars.innerHTML = "";
  d.months.forEach((m, i) => { const b = document.createElement("div"); b.className = "bar"; const bar = document.createElement("i"); bar.style.height = "0"; const label = document.createElement("span"); label.textContent = m; b.title = m + ": " + d.values[i]; b.append(bar, label); bars.append(b); requestAnimationFrame(() => bar.style.height = (d.values[i] / max * 110) + "px"); });
}`,
      jsExpressions: ["showDash(DASH)"],
    },
  },
  {
    name: "Price comparison",
    description: "Compare 2-4 options side by side; weights pick the best for you.",
    data: "Options (name, price, delivery days, rating out of 5, notes) and the currency.",
    builtIn: true,
    card: {
      initialHeight: 320,
      css: `.cmp{display:grid;gap:12px}.opts{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.opt{padding:12px;border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg)}.opt.best{border-color:var(--color-border-success);background:var(--color-background-success)}
.opt b{display:block;font-size:18px}.w{display:grid;grid-template-columns:110px 1fr 36px;align-items:center;gap:8px;font-size:13px}`,
      html: `<div class="cmp"><div class="opts" id="opts"></div><div class="w"><label for="wp">Price matters</label><input type="range" id="wp" min="0" max="10" value="6"><span id="wpv"></span></div>
<div class="w"><label for="wd">Speed matters</label><input type="range" id="wd" min="0" max="10" value="3"><span id="wdv"></span></div>
<div class="w"><label for="wr">Rating matters</label><input type="range" id="wr" min="0" max="10" value="5"><span id="wrv"></span></div>
<div class="row"><button class="primary" id="pick">Go with the best option</button></div></div>`,
      jsFunctions: `const CMP = { currency: "AED", options: [{ name: "Supplier A", price: 4200, days: 5, rating: 4.2, notes: "Free delivery" }, { name: "Supplier B", price: 3900, days: 12, rating: 3.8, notes: "Pay in 30 days" }, { name: "Supplier C", price: 4600, days: 2, rating: 4.7, notes: "Express" }] };
function scoreAll(d) {
  const w = { p: +wp.value, d: +wd.value, r: +wr.value }; wpv.textContent = w.p; wdv.textContent = w.d; wrv.textContent = w.r;
  const min = k => Math.min(...d.options.map(o => o[k])), max = k => Math.max(...d.options.map(o => o[k]));
  const norm = (v, lo, hi, inverse) => hi === lo ? 1 : inverse ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
  const scored = d.options.map(o => ({ o, s: w.p * norm(o.price, min("price"), max("price"), true) + w.d * norm(o.days, min("days"), max("days"), true) + w.r * norm(o.rating, min("rating"), max("rating"), false) }));
  const best = scored.reduce((a, b) => b.s > a.s ? b : a);
  opts.innerHTML = ""; for (const { o, s } of scored) { const el = document.createElement("div"); el.className = "opt" + (o === best.o ? " best" : "");
    el.innerHTML = '<span class="muted"></span><b></b><div></div><div class="muted"></div>'; el.children[0].textContent = o.name + (o === best.o ? " · best fit" : ""); el.children[1].textContent = d.currency + " " + o.price.toLocaleString();
    el.children[2].textContent = o.days + " days · " + o.rating + "★"; el.children[3].textContent = o.notes || ""; opts.append(el); }
  pick.onclick = () => filey.send("Go with " + best.o.name + " (" + d.currency + " " + best.o.price + ", " + best.o.days + " days). Draft the purchase order.");
}`,
      jsExpressions: ["for (const id of ['wp','wd','wr']) document.getElementById(id).oninput = () => scoreAll(CMP)", "scoreAll(CMP)"],
    },
  },
];

async function settingsRow(): Promise<CardTemplate[]> {
  const { tools } = await import("./api");
  const row = (await tools.settings()).find(r => r.key === TEMPLATE_KEY);
  if (!row) return [];
  const parsed: unknown = JSON.parse(row.value);
  if (!Array.isArray(parsed)) throw new Error("Saved card templates are unreadable. Nothing was changed.");
  return parsed as CardTemplate[];
}

export async function listCardTemplates(): Promise<CardTemplate[]> {
  return [...BUILT_IN_TEMPLATES, ...(await settingsRow())];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function findCardTemplate(name: string): Promise<CardTemplate | undefined> {
  const all = await listCardTemplates();
  return all.find(t => same(t.name, name)) ?? all.find(t => t.name.toLowerCase().includes(name.trim().toLowerCase()));
}

/** Saves (or replaces, by name) one of the user's templates. Built-ins stay as shipped. */
export async function saveCardTemplate(t: CardTemplate): Promise<void> {
  if (!t.name.trim()) throw new Error("Name the template.");
  if (BUILT_IN_TEMPLATES.some(b => same(b.name, t.name))) throw new Error(`"${t.name}" is a built-in template. Save yours under another name.`);
  const saved = (await settingsRow()).filter(x => !same(x.name, t.name));
  if (saved.length >= MAX_TEMPLATES) throw new Error(`You have ${MAX_TEMPLATES} templates. Delete one first.`);
  const { tools } = await import("./api");
  await tools.setSetting(TEMPLATE_KEY, JSON.stringify([...saved, { ...t, name: t.name.trim().slice(0, 80), builtIn: undefined, savedAt: Date.now() }]));
}

export async function deleteCardTemplate(name: string): Promise<boolean> {
  const saved = await settingsRow();
  const kept = saved.filter(x => !same(x.name, name));
  if (kept.length === saved.length) return false;
  const { tools } = await import("./api");
  await tools.setSetting(TEMPLATE_KEY, JSON.stringify(kept));
  return true;
}

/* ---------------- Starter gallery (OpenIntelligentUI's demo gallery) ---------------- */

export type DemoCategory = "Understand" | "Compare" | "Make a tool";
export const DEMO_CATEGORIES: DemoCategory[] = ["Understand", "Compare", "Make a tool"];
export const DEMOS: { title: string; description: string; category: DemoCategory; prompt: string }[] = [
  { title: "My sales, at a glance", category: "Understand", description: "A live dashboard from your invoices.",
    prompt: "Build an interactive dashboard of my sales from my real invoices: monthly totals, top customers and unpaid amounts, grouped by currency. Let me switch between the last 3, 6 and 12 months. Use only data from my workspace and say what is missing." },
  { title: "Break-even, explained", category: "Understand", description: "Move costs and prices, watch the line cross.",
    prompt: "Explain break-even with an interactive chart: sliders for fixed costs, variable cost per unit and price per unit, showing revenue and cost lines and the break-even quantity. Label the formula and assumptions." },
  { title: "How UAE VAT flows", category: "Understand", description: "Output VAT, input VAT and what you pay.",
    prompt: "Explain how UAE VAT flows from sales and purchases to the return with a clear diagram, and let me enter sales and purchase amounts to see output VAT, input VAT and net payable at 5%. Label it as a simplified illustration, not tax advice." },
  { title: "Compare supplier quotes", category: "Compare", description: "Price, speed and rating, weighted your way.",
    prompt: "Help me compare three supplier quotes in an interactive card: price, delivery days and rating, with sliders for how much each matters, and highlight the best fit. Ask me for the quotes if I haven't given them, and use clearly labeled examples until then." },
  { title: "Pricing options", category: "Compare", description: "Three price points, margins side by side.",
    prompt: "Compare three price points for a product side by side: unit cost, price, margin, markup and profit at an expected volume, with editable inputs. Flag any price below cost." },
  { title: "Loan or lease", category: "Compare", description: "Monthly cost and total, both ways.",
    prompt: "Compare buying equipment with a loan versus leasing it: editable price, rate, term, lease payment and residual value; show monthly and total cost for each and which is cheaper. Label it as an estimate." },
  { title: "VAT calculator", category: "Make a tool", description: "Add or remove 5% VAT in one click.",
    prompt: "Make an interactive VAT calculator for AED at 5%: add VAT or extract it from a VAT-inclusive amount, showing net, VAT and gross, with a button to ask you to draft an invoice for the total." },
  { title: "Margin & markup", category: "Make a tool", description: "Cost and price in, margin out.",
    prompt: "Build a margin and markup calculator: enter cost and either price, margin % or markup %, and get the other values. Validate inputs and explain the difference between margin and markup." },
  { title: "Payment plan", category: "Make a tool", description: "Split a total into instalments.",
    prompt: "Build a payment plan tool: total amount, deposit, number of instalments and start date; list each instalment with its date and amount so they add up exactly to the total. Add a button to ask you to send the plan to the customer." },
];

/* ---------------- Pictures for cards ---------------- */

const WIKIMEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;

async function dataUrl(blob: Blob): Promise<string> {
  if (blob.size > 8 * 1024 * 1024) throw new Error("Picture is over 8 MB.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Turns a card's image sources into src values the card origin can show.
 *  `pending` lists generated images still waiting for the user's Generate click. */
export async function resolveCardImages(images: GenUiImage[]): Promise<{ resolved: Record<string, string>; pending: string[]; failed: string[] }> {
  const resolved: Record<string, string> = {}, pending: string[] = [], failed: string[] = [];
  for (const { name, source } of images) {
    try {
      if (WIKIMEDIA.test(source)) resolved[name] = source;
      else if (source.startsWith("media:")) {
        const { getMediaJob } = await import("./aiMedia");
        const job = getMediaJob(source.slice(6).trim());
        if (job.state !== "completed") { (["failed", "canceled"].includes(job.state) ? failed : pending).push(name); continue; }
        const { mediaBlob } = await import("./aiMediaStore");
        const { agentStorageScope } = await import("./agentStorage");
        const blob = job.blob ? await mediaBlob(job.id, agentStorageScope() ?? "signed-out") : undefined;
        if (blob) resolved[name] = await dataUrl(blob);
        else if (job.outputUrl) {
          const { aiFetch } = await import("./ai");
          resolved[name] = await dataUrl(await (await aiFetch(job.outputUrl, { method: "GET" }, { retries: 0 })).blob());
        } else failed.push(name);
      } else if (source.startsWith("file:")) {
        const want = source.slice(5).trim().toLowerCase();
        const { listFiles, fileBytes } = await import("./files");
        const file = (await listFiles()).find(f => f.mime.startsWith("image/") && f.name.toLowerCase() === want);
        const bytes = file && await fileBytes(file);
        if (file && bytes) resolved[name] = await dataUrl(new Blob([bytes as BlobPart], { type: file.mime }));
        else failed.push(name);
      } else failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { resolved, pending, failed };
}

export interface CommonsPhoto { status: "available"; subject: string; image_url: string; artist: string; license: string; credit_url: string; article_url: string; note: string }

/** A reusable, attributed photo of a subject from its Wikipedia article (Wikimedia
 *  Commons), as OpenIntelligentUI's trip images: never an arbitrary web image. */
export async function findCommonsPhoto(subject: string, signal?: AbortSignal): Promise<CommonsPhoto> {
  const { aiFetch } = await import("./ai");
  const headers = { "Api-User-Agent": "FileyERP/3 (https://gofiley.com)", accept: "application/json" };
  const get = async (url: string) => {
    const res = await aiFetch(url, { method: "GET", headers, signal }, { retries: 1 });
    if (!res.ok) throw new Error(`Wikipedia answered ${res.status}.`);
    return res.json();
  };
  let title = subject.trim();
  if (!title) throw new Error("Name the subject.");
  let summary: { title?: string; thumbnail?: { source?: string }; originalimage?: { source?: string } } | undefined;
  try {
    summary = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  } catch {
    const found = await get(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(title)}&limit=1`);
    title = found?.pages?.[0]?.title;
    if (!title) throw new Error(`No Wikipedia article found for "${subject}".`);
    summary = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  }
  const image = summary?.thumbnail?.source ?? "", original = summary?.originalimage?.source ?? "";
  if (!WIKIMEDIA.test(image) || !WIKIMEDIA.test(original)) throw new Error(`The "${title}" article has no Wikimedia photo.`);
  const fileOf = (url: string) => {
    const m = new URL(url).pathname.match(/^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
    if (!m) throw new Error("That photo isn't on Wikimedia Commons.");
    return decodeURIComponent(m[1]).replace(/ /g, "_");
  };
  const file = fileOf(original);
  if (fileOf(image) !== file) throw new Error("The photo and its credit refer to different files.");
  const meta = await get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent("File:" + file)}`);
  const page = Object.values(meta?.query?.pages ?? {})[0] as { imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] } | undefined;
  const info = page?.imageinfo?.[0]?.extmetadata ?? {};
  // Commons metadata is HTML from strangers: read it in an inert document, never the app's.
  const plain = (key: string) =>
    (new DOMParser().parseFromString(info[key]?.value ?? "", "text/html").body.textContent ?? "").trim().slice(0, 300);
  const license = plain("LicenseShortName"), artist = plain("Artist");
  if (!artist || !license || !(license.startsWith("CC") || /^public domain$/i.test(license)))
    throw new Error("No reusable licence and credit were available for that photo.");
  return {
    status: "available", subject: summary?.title ?? title, image_url: image, artist, license,
    credit_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
    article_url: `https://en.wikipedia.org/wiki/${encodeURIComponent((summary?.title ?? title).replace(/ /g, "_"))}`,
    note: "Photo from this Wikipedia article: credit the artist and licence under it, and check it shows the right subject.",
  };
}
