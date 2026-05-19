import { useEffect, useMemo, useState } from "react";
import {
  Save,
  Eye,
  Download,
  RefreshCw,
  Plus,
  Trash2,
  PackageSearch,
  Check,
  X,
  CalendarDays,
  Send,
} from "lucide-react";
import {
  billing,
  crm,
  erp,
  quotes,
  quoteTemplates,
  CompanyProfile,
  CrmCustomer,
  Product,
  QuoteTemplate,
  QuotationInput,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { fmtDate } from "../lib/format";
import { quotationTotals } from "../lib/money";
import { sendEmail, emailShell, hasDesktop } from "../lib/email";
import { Modal, Field } from "../components/ui";

interface Line {
  product: string;
  sku: string;
  qty: number;
  rate: number;
  discount: number; // percent
  tax: number; // percent
}

const TEMPLATES = [
  { id: "clean", name: "Modern Clean" },
  { id: "professional", name: "Professional" },
  { id: "minimal", name: "Minimal" },
  { id: "corporate", name: "Corporate" },
  { id: "classic", name: "Classic" },
];

const STEPS = [
  "Choose Template",
  "Add Details",
  "Add Products",
  "Review & Send",
];

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const qtNo = () =>
  `QT-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 900000) + 100000
  )}`;

function money(v: number, ccy: string) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 2,
    }).format(v || 0);
  } catch {
    return `${ccy} ${(v || 0).toFixed(2)}`;
  }
}

const lineAmount = (l: Line) =>
  l.qty * l.rate * (1 - (l.discount || 0) / 100);

export default function Quoting() {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [tpl, setTpl] = useState("clean");
  const [step, setStep] = useState(0);
  const [number, setNumber] = useState(qtNo());
  const [date, setDate] = useState(today());
  const [valid, setValid] = useState(addDays(30));
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [salesPerson, setSalesPerson] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { product: "", sku: "", qty: 1, rate: 0, discount: 0, tax: 12 },
  ]);
  const [terms] = useState(
    "1. This quotation is valid until the date mentioned above.\n2. Payment is due within 15 days from the date of invoice.\n3. All prices are inclusive of applicable taxes."
  );
  const [custModal, setCustModal] = useState(false);
  const [invModal, setInvModal] = useState(false);
  const [vat, setVat] = useState(true);
  const [docId, setDocId] = useState<number | undefined>(undefined);
  const [saved, setSaved] = useState<QuoteTemplate[]>([]);
  const [savedNote, setSavedNote] = useState(false);

  const loadTemplates = () =>
    quoteTemplates.list().then(setSaved).catch(() => {});

  useEffect(() => {
    billing
      .getCompany()
      .then((c) => {
        setCompany(c);
        if (c?.currency) setCurrency(c.currency);
      })
      .catch(() => {});
    crm.customers().then(setCustomers).catch(() => {});
    loadTemplates();
  }, []);

  // Live-sync only the shared lists — re-pulling company here would
  // stomp a currency the user picked while drafting this quote.
  useLiveSync(() => {
    crm.customers().then(setCustomers).catch(() => {});
    loadTemplates();
  });

  const totals = useMemo(
    () =>
      quotationTotals(vat ? lines : lines.map((l) => ({ ...l, tax: 0 }))),
    [lines, vat]
  );

  const m = (v: number) => money(v, currency);

  const emailQuote = async () => {
    const to = customer?.email;
    if (!to) {
      alert("Select a customer with an email address first.");
      return;
    }
    try {
      await sendEmail({
        to,
        subject: `Quotation ${number} from ${company?.name ?? "us"}`,
        html: emailShell(
          `Quotation ${number}`,
          `<p>Dear ${customer?.company || customer?.name || "customer"},</p>
           <p>Please find your quotation <b>${number}</b>, valid until ${valid}.</p>
           <table style="width:100%;font-size:14px;margin:12px 0">
             <tr><td>Subtotal</td><td style="text-align:right">${m(
               totals.subtotal
             )}</td></tr>
             <tr><td>Discount</td><td style="text-align:right">-${m(
               totals.discount
             )}</td></tr>
             <tr><td>Tax</td><td style="text-align:right">${m(
               totals.tax
             )}</td></tr>
             <tr><td><b>Total (${currency})</b></td><td style="text-align:right"><b>${m(
               totals.total
             )}</b></td></tr>
           </table>
           <p>Thank you for your business.</p>`
        ),
      });
      alert(`Quotation emailed to ${to}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { product: "", sku: "", qty: 1, rate: 0, discount: 0, tax: 12 },
    ]);
  const delLine = (i: number) =>
    setLines((ls) => ls.filter((_, x) => x !== i));

  const accent =
    tpl === "corporate"
      ? "#222222"
      : tpl === "classic"
      ? "#4A453B"
      : "#E0AE00";

  const saveDraft = async () => {
    const trn = customer?.segment?.startsWith("TRN:")
      ? customer.segment.slice(4).trim()
      : undefined;
    const input: QuotationInput = {
      id: docId,
      number,
      status: "draft",
      template: tpl,
      accent,
      currency,
      quote_date: date,
      valid_until: valid,
      sales_person: salesPerson || undefined,
      customer_name: customer?.company || customer?.name || "",
      customer_address: customer?.address,
      customer_trn: trn,
      customer_email: customer?.email,
      terms,
      items: lines.map((l) => ({
        product: l.product,
        sku: l.sku || undefined,
        qty: l.qty,
        rate: l.rate,
        discount: l.discount,
        tax: vat ? l.tax : 0,
      })),
    };
    try {
      const newId = await quotes.saveDoc(input);
      if (newId && newId > 0) setDocId(newId);
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2500);
    } catch (e) {
      alert(`Could not save: ${e}`);
    }
  };

  const saveTemplate = async () => {
    const name = prompt("Template name?");
    if (!name) return;
    try {
      await quoteTemplates.create(name, tpl);
      loadTemplates();
    } catch (e) {
      alert(`Could not save template: ${e}`);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-[26px] leading-8 font-bold text-ink">
            Create Quotation
          </h1>
          <p className="text-sm text-brand-500 mt-0.5">
            Create professional quotations in minutes and convert leads
            faster
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedNote && (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
              <Check size={15} /> Draft saved
            </span>
          )}
          <button className="btn-ghost" onClick={saveDraft}>
            <Save size={15} /> Save Draft
          </button>
          <button
            className="btn-ghost"
            onClick={() => setStep(3)}
          >
            <Eye size={15} /> Preview
          </button>
          {hasDesktop ? (
            <button className="btn-ghost" onClick={emailQuote}>
              <Send size={15} /> Email
            </button>
          ) : (
            <span
              className="text-[11px] text-brand-400 self-center"
              title="Emailing is available in the Filey desktop app"
            >
              Emailing is desktop-only
            </span>
          )}
          <button className="btn-primary" onClick={() => window.print()}>
            <Download size={15} /> Generate PDF
          </button>
        </div>
      </div>

      {/* stepper */}
      <div className="no-print card !py-3 mb-4 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            className="flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <span
              className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold ${
                i <= step
                  ? "bg-primary-400 text-ink"
                  : "bg-brand-100 text-brand-400"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`text-sm font-semibold ${
                i === step ? "text-primary-700" : "text-brand-500"
              }`}
            >
              {s}
            </span>
            {i < STEPS.length - 1 && (
              <span className="w-8 h-px bg-brand-200 mx-1" />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(340px,440px)] gap-5 items-start">
        {/* builder */}
        <div className="no-print space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-ink">Choose Template</p>
              <button
                className="btn-ghost text-xs"
                onClick={saveTemplate}
              >
                View all templates
              </button>
            </div>
            <p className="text-xs text-brand-400 mb-4">
              Select a template for your quotation
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {TEMPLATES.map((t) => {
                const on = tpl === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTpl(t.id)}
                    className={`relative shrink-0 w-32 rounded-xl border-2 p-2 text-left cursor-pointer transition-all ${
                      on
                        ? "border-primary-400 bg-primary-50 shadow-glow"
                        : "border-brand-200 bg-white hover:border-primary-300"
                    }`}
                  >
                    {on && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    <div className="h-24 rounded-md bg-brand-50 border border-brand-100 p-2">
                      <div className="h-1.5 w-10 rounded bg-brand-300" />
                      <div className="mt-1 h-1 w-16 rounded bg-brand-200" />
                      <div className="mt-3 space-y-1">
                        <div className="h-1 w-full rounded bg-brand-200" />
                        <div className="h-1 w-2/3 rounded bg-brand-200" />
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-ink mt-2">
                      {t.name}
                    </p>
                  </button>
                );
              })}
              <button
                onClick={saveTemplate}
                className="shrink-0 w-32 rounded-xl border-2 border-dashed border-brand-300 grid place-items-center text-brand-500 hover:bg-brand-50 cursor-pointer"
              >
                <span className="text-center">
                  <Plus size={18} className="mx-auto" />
                  <span className="text-xs font-semibold block mt-1">
                    Create New Template
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="card">
            <p className="font-bold text-ink mb-1">Quotation Details</p>
            <p className="text-xs text-brand-400 mb-4">
              Add basic information for your quotation
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Quotation Number">
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                  <button
                    className="grid place-items-center rounded-xl border border-brand-200 px-2.5 text-brand-400 hover:bg-brand-50 cursor-pointer"
                    onClick={() => setNumber(qtNo())}
                    title="Regenerate"
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
              </Field>
              <Field label="Quotation Date">
                <input
                  type="date"
                  className="input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Valid Until">
                <input
                  type="date"
                  className="input"
                  value={valid}
                  onChange={(e) => setValid(e.target.value)}
                />
              </Field>
              <Field label="Customer">
                <div className="flex gap-2">
                  <select
                    className="select"
                    value={customer?.id ?? ""}
                    onChange={(e) =>
                      setCustomer(
                        customers.find(
                          (c) => String(c.id) === e.target.value
                        ) ?? null
                      )
                    }
                  >
                    <option value="">Select customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company || c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-ghost shrink-0 text-xs"
                    onClick={() => setCustModal(true)}
                  >
                    <Plus size={13} /> New
                  </button>
                </div>
              </Field>
              <Field label="Currency">
                <select
                  className="select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {["USD", "AED", "EUR", "GBP", "INR"].map((c) => (
                    <option key={c} value={c}>
                      {c} - {c === "AED" ? "UAE Dirham" : c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sales Person">
                <input
                  className="input"
                  placeholder="Olivia Rhye"
                  value={salesPerson}
                  onChange={(e) => setSalesPerson(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
              <p className="font-bold text-ink">Products</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-brand-500">
                  VAT
                </span>
                <div className="flex rounded-lg bg-brand-100 p-0.5">
                  {([["Yes", true], ["No", false]] as const).map(
                    ([lbl, on]) => (
                      <button
                        key={lbl}
                        type="button"
                        onClick={() => setVat(on)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                          vat === on
                            ? "bg-white text-ink shadow-bento"
                            : "text-brand-500 hover:text-ink"
                        }`}
                      >
                        {lbl}
                      </button>
                    )
                  )}
                </div>
                <button className="btn-ghost text-xs" onClick={addLine}>
                  <Plus size={13} /> Add Product
                </button>
              </div>
            </div>
            <p className="text-xs text-brand-400 mb-3">
              Add products and their rates
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-brand-400">
                    <th className="py-2 w-6">#</th>
                    <th className="py-2 px-2">Product</th>
                    <th className="py-2 px-2 w-24">SKU</th>
                    <th className="py-2 px-2 w-16 text-right">Qty</th>
                    <th className="py-2 px-2 w-24 text-right">Rate</th>
                    <th className="py-2 px-2 w-16 text-right">Disc%</th>
                    {vat && (
                      <th className="py-2 px-2 w-16 text-right">Tax%</th>
                    )}
                    <th className="py-2 px-2 w-24 text-right">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-brand-100">
                      <td className="py-2 text-brand-400">{i + 1}</td>
                      <td className="py-2 px-2">
                        <input
                          className="input"
                          placeholder="Product name"
                          value={l.product}
                          onChange={(e) =>
                            setLine(i, { product: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input"
                          value={l.sku}
                          onChange={(e) =>
                            setLine(i, { sku: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right"
                          value={l.qty}
                          onChange={(e) =>
                            setLine(i, { qty: +e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right"
                          placeholder="0"
                          value={l.rate || ""}
                          onChange={(e) =>
                            setLine(i, { rate: +e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right"
                          placeholder="0"
                          value={l.discount || ""}
                          onChange={(e) =>
                            setLine(i, { discount: +e.target.value })
                          }
                        />
                      </td>
                      {vat && (
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            className="input text-right"
                            placeholder="0"
                            value={l.tax || ""}
                            onChange={(e) =>
                              setLine(i, { tax: +e.target.value })
                            }
                          />
                        </td>
                      )}
                      <td className="py-2 px-2 text-right font-semibold text-ink">
                        {m(lineAmount(l))}
                      </td>
                      <td className="py-2">
                        <button
                          aria-label="Remove"
                          className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                          onClick={() => delLine(i)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4 mt-4">
              <button
                className="btn-ghost"
                onClick={() => setInvModal(true)}
              >
                <PackageSearch size={15} /> Import from Inventory
              </button>
              <div className="w-64 text-sm">
                <p className="text-xs font-semibold text-brand-400 mb-2">
                  Summary
                </p>
                <Row k="Subtotal" v={m(totals.subtotal)} />
                <Row
                  k="Discount"
                  v={`-${m(totals.discount)}`}
                  tone="text-success"
                />
                {vat && <Row k="Tax" v={m(totals.tax)} />}
                <div className="flex justify-between py-2 mt-1 border-t border-brand-200 font-bold text-ink">
                  <span>Total ({currency})</span>
                  <span>{m(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* preview */}
        <div className="xl:sticky xl:top-2 space-y-4">
          <div className="card !p-4">
            <p className="font-bold text-ink no-print">Quotation Preview</p>
            <p className="text-xs text-brand-400 mb-3 no-print">
              This is how your quotation will look
            </p>
            <div className="invoice-print bg-white border border-brand-200 rounded-xl p-7 text-neutral-900">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  {company?.logo && (
                    <img
                      src={company.logo}
                      alt="logo"
                      className="h-9 object-contain"
                    />
                  )}
                  <span
                    className="text-lg font-bold"
                    style={{ color: accent }}
                  >
                    {company?.name ?? "Your Company"}
                  </span>
                </div>
                <div className="text-right">
                  <p
                    className="text-2xl font-bold tracking-tight"
                    style={{ color: accent }}
                  >
                    QUOTATION
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {number}
                  </p>
                </div>
              </div>

              <div className="flex justify-between mt-6 text-xs">
                <div>
                  <p className="uppercase tracking-wide text-neutral-400">
                    From
                  </p>
                  <p className="font-semibold text-sm mt-1">
                    {company?.name}
                  </p>
                  <p className="text-neutral-500 whitespace-pre-line">
                    {company?.address}
                  </p>
                  {company?.email && (
                    <p className="text-neutral-500">{company.email}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="uppercase tracking-wide text-neutral-400">
                    To
                  </p>
                  <p className="font-semibold text-sm mt-1">
                    {customer?.company || customer?.name || "Customer"}
                  </p>
                  <p className="text-neutral-500 whitespace-pre-line">
                    {customer?.address}
                  </p>
                  <p className="text-neutral-500 mt-2">
                    Date: {fmtDate(date)}
                  </p>
                  <p className="text-neutral-500">
                    Valid Until: {fmtDate(valid)}
                  </p>
                </div>
              </div>

              <table className="w-full text-xs mt-6 border-collapse">
                <thead>
                  <tr
                    style={{ color: accent }}
                    className="border-b-2 text-left"
                  >
                    <th className="py-2">#</th>
                    <th className="py-2">Item</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Disc</th>
                    {vat && <th className="py-2 text-right">Tax</th>}
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-neutral-200">
                      <td className="py-2">{i + 1}</td>
                      <td className="py-2">
                        <p className="font-semibold">
                          {l.product || "—"}
                        </p>
                        <p className="text-neutral-400">{l.sku}</p>
                      </td>
                      <td className="py-2 text-right">{l.qty}</td>
                      <td className="py-2 text-right">{m(l.rate)}</td>
                      <td className="py-2 text-right">{l.discount}%</td>
                      {vat && (
                        <td className="py-2 text-right">{l.tax}%</td>
                      )}
                      <td className="py-2 text-right font-semibold">
                        {m(lineAmount(l))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="ml-auto w-60 mt-5 text-xs">
                <Row k="Subtotal" v={m(totals.subtotal)} />
                <Row
                  k="Discount"
                  v={`-${m(totals.discount)}`}
                  tone="text-green-600"
                />
                {vat && <Row k="Tax" v={m(totals.tax)} />}
                <div
                  className="flex justify-between py-2 mt-1 font-bold text-sm"
                  style={{ borderTop: `2px solid ${accent}`, color: accent }}
                >
                  <span>Total ({currency})</span>
                  <span>{m(totals.total)}</span>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-neutral-200">
                <p className="text-xs font-semibold">Terms &amp; Conditions</p>
                <p className="text-[11px] text-neutral-500 whitespace-pre-line mt-1">
                  {terms}
                </p>
                <p className="text-xs font-semibold mt-3">
                  Thank you for your business!
                </p>
              </div>
            </div>
          </div>

          <div className="card no-print">
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-ink">Saved Templates</p>
              <button
                className="btn-ghost text-xs"
                onClick={saveTemplate}
              >
                View all
              </button>
            </div>
            <p className="text-xs text-brand-400 mb-3">
              Manage your custom templates
            </p>
            <div className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-brand-200 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-ink">
                    {s.name}
                  </p>
                  <p className="text-[10px] text-brand-400 flex items-center gap-1">
                    <CalendarDays size={10} />
                    {fmtDate(s.created_at)}
                  </p>
                </div>
              ))}
              <button
                onClick={saveTemplate}
                className="rounded-xl border border-dashed border-brand-300 px-3 py-2 text-brand-500 text-xs font-semibold hover:bg-brand-50 cursor-pointer flex items-center gap-1"
              >
                <Plus size={13} /> New Template
              </button>
            </div>
          </div>
        </div>
      </div>

      <CustomerModal
        open={custModal}
        onClose={() => setCustModal(false)}
        onSaved={(c) => {
          setCustomer(c);
          setCustModal(false);
          crm.customers().then(setCustomers).catch(() => {});
        }}
      />
      <InventoryModal
        open={invModal}
        onClose={() => setInvModal(false)}
        onPick={(p) => {
          setLines((ls) => [
            ...ls.filter((l) => l.product || l.rate),
            {
              product: p.name,
              sku: p.sku,
              qty: 1,
              rate: p.unit_price,
              discount: 0,
              tax: 12,
            },
          ]);
          setInvModal(false);
        }}
      />
    </div>
  );
}

function Row({
  k,
  v,
  tone = "text-neutral-600",
}: {
  k: string;
  v: string;
  tone?: string;
}) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-neutral-500">{k}</span>
      <span className={tone}>{v}</span>
    </div>
  );
}

function CustomerModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (c: CrmCustomer) => void;
}) {
  const [f, setF] = useState({
    company: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    trn: "",
  });
  useEffect(() => {
    if (open)
      setF({
        company: "",
        name: "",
        address: "",
        email: "",
        phone: "",
        trn: "",
      });
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="New Customer">
      <div className="space-y-3">
        <Field label="Company / Legal Name">
          <input
            className="input"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact Name">
            <input
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
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
        <Field label="Billing Address">
          <textarea
            className="textarea"
            rows={2}
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              className="input"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="TRN">
            <input
              className="input"
              value={f.trn}
              onChange={(e) => setF({ ...f, trn: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!f.company.trim() && !f.name.trim()}
          onClick={async () => {
            const payload = {
              name: f.name || f.company,
              company: f.company || undefined,
              email: f.email || undefined,
              phone: f.phone || undefined,
              address: f.address || undefined,
              segment: f.trn ? `TRN:${f.trn}` : undefined,
            };
            try {
              await crm.createCustomer(
                payload as Omit<CrmCustomer, "id" | "created_at">
              );
            } catch (e) {
              console.error(e);
            }
            onSaved({ id: 0, created_at: "", ...payload } as CrmCustomer);
          }}
        >
          Save Customer
        </button>
      </div>
    </Modal>
  );
}

function InventoryModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) erp.products().then(setProducts).catch(() => {});
  }, [open]);
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Modal open={open} onClose={onClose} title="Import from Inventory">
      <input
        className="input mb-3"
        placeholder="Search products…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-72 overflow-y-auto space-y-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2 hover:bg-brand-50 cursor-pointer text-left"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{p.name}</p>
              <p className="text-[11px] text-brand-400">{p.sku}</p>
            </div>
            <span className="text-sm font-semibold text-ink">
              {p.unit_price}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-brand-400 text-center py-6">
            No products found.
          </p>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <button className="btn-ghost" onClick={onClose}>
          <X size={14} /> Close
        </button>
      </div>
    </Modal>
  );
}
