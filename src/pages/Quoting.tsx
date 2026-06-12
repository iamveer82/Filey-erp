import { useEffect, useMemo, useRef, useState } from "react";
import {
  Save,
  Download,
  Eye,
  RefreshCw,
  Plus,
  Trash2,
  PackageSearch,
  Check,
  X,
  CalendarDays,
  Send,
  FileText,
  Upload,
  Stamp,
  PenTool,
  Landmark,
  Monitor,
  Smartphone,
  Minus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { useUI } from "../lib/ui";
import { fmtDate, money, numInput, CURRENCIES, errMsg } from "../lib/format";
import { quotationTotals } from "../lib/money";
import { sendEmail, emailShell, esc } from "../lib/email";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import { Modal, Field } from "../components/ui";
import FitPreview from "../components/FitPreview";
import {
  StampSigCard,
  StampSignatureLayer,
  STAMP_DEFAULT,
  SIGN_DEFAULT,
  type StampSig,
} from "../components/StampSignature";
import {
  BankDetailsBlock,
  loadBankInfo,
  EMPTY_BANK,
  type BankInfo,
} from "../components/BankDetails";
import TemplateTilePreview from "../components/TemplateTilePreview";
import TemplateDesigner, { loadCustomTemplates, deleteCustomTemplate, type CustomTemplate } from "../components/TemplateDesigner";

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

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const qtNo = () =>
  `QT-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 900000) + 100000
  )}`;

const lineAmount = (l: Line) =>
  l.qty * l.rate * (1 - (l.discount || 0) / 100);

export default function Quoting() {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [tpl, setTpl] = useState("clean");
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
  const [viewOpen, setViewOpen] = useState(false);
  const [saved, setSaved] = useState<QuoteTemplate[]>([]);
  const [designing, setDesigning] = useState(false);
  const [stamp, setStamp] = useState<StampSig | undefined>(undefined);
  const [signature, setSignature] = useState<StampSig | undefined>(undefined);
  const [showBank, setShowBank] = useState(false);
  const [bank, setBank] = useState<BankInfo>(EMPTY_BANK);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [viewAll, setViewAll] = useState(false);

  // Close view modal on Escape
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);
  const quotePreviewRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);
  const [savedNote, setSavedNote] = useState(false);
  const [converting, setConverting] = useState(false);
  const navigate = useNavigate();
  const { toast, prompt, confirm } = useUI();
  const removeCustomTpl = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: "Delete template",
        message: `Delete custom template "${name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setCustomTemplates(deleteCustomTemplate(id));
    if (tpl === id) setTpl("clean");
    toast.success("Template deleted.");
  };
  const quoteRef = useRef<HTMLDivElement>(null);
  const downloadQuotePdf = () => {
    if (quoteRef.current) {
      const sheet = quoteRef.current.closest('.invoice-print') as HTMLElement;
      downloadElementAsPdf(sheet || quoteRef.current, "quotation");
    } else window.print();
  };

  // Calculate page count for the full-screen preview
  useEffect(() => {
    if (!viewOpen || !quotePreviewRef.current) { setPageCount(1); return; }
    const el = quotePreviewRef.current;
    const measure = () => {
      const contentHeight = el.scrollHeight;
      const pageHeight = 1027; // A4 at 96dpi minus padding
      setPageCount(Math.max(1, Math.ceil(contentHeight / pageHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [viewOpen, lines.length, tpl]);

  const loadTemplates = () =>
    quoteTemplates.list().then(setSaved).catch(() => toast.error("Failed to load templates"));

  useEffect(() => {
    billing
      .getCompany()
      .then((c) => {
        setCompany(c);
        if (c?.currency) setCurrency(c.currency);
      })
      .catch(() => toast.error("Failed to load company profile"));
    crm.customers().then(setCustomers).catch(() => toast.error("Failed to load customers"));
    loadTemplates();
    loadBankInfo().then(setBank).catch(() => {});
  }, []);

  // Live-sync only the shared lists — re-pulling company here would
  // stomp a currency the user picked while drafting this quote.
  useLiveSync(() => {
    crm.customers().then(setCustomers).catch(() => toast.error("Failed to load customers"));
    loadTemplates();
  });

  const totals = useMemo(
    () =>
      quotationTotals(vat ? lines : lines.map((l) => ({ ...l, tax: 0 }))),
    [lines, vat]
  );

  const m = (v: number) => money(v, currency);

  // Built-in + custom templates; collapsed view shows only the first 4.
  const allTemplates = [
    ...TEMPLATES,
    ...customTemplates.map((t) => ({ id: t.id, name: t.name })),
  ];
  const shownTemplates = viewAll ? allTemplates : allTemplates.slice(0, 4);

  const emailQuote = async () => {
    const to = customer?.email;
    if (!to) {
      toast.error("Select a customer with an email address first.");
      return;
    }
    try {
      await sendEmail({
        to,
        subject: `Quotation ${number} from ${company?.name ?? "us"}`,
        html: emailShell(
          `Quotation ${number}`,
          `<p>Dear ${esc(customer?.company || customer?.name || "customer")},</p>
           <p>Please find your quotation <b>${esc(number)}</b>, valid until ${esc(valid)}.</p>
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
      toast.success(`Quotation emailed to ${to}`);
    } catch (e) {
      toast.error(errMsg(e));
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
    // Validate
    if (!number.trim()) { toast.error("Quotation number is required"); return; }
    if (!lines.length || lines.every(l => !l.product.trim() && !(l as any).description?.trim())) {
      toast.error("Add at least one line item with a product or description");
      return;
    }
    if (!customer?.company?.trim() && !customer?.name?.trim() && !customer?.email?.trim()) {
      toast.error("Customer name or email is required");
      return;
    }
    const trn =
      customer?.trn ??
      (customer?.segment?.startsWith("TRN:")
        ? customer.segment.slice(4).trim()
        : undefined);
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
      // Archive the quotation PDF to My Files (deduped, best-effort).
      if (quoteRef.current) {
        const base = number || "quotation";
        const saved = await autoSaveDocument(`${base}.pdf`, "quotation", () => elementToPdfBytes(quoteRef.current!, base));
        if (saved) toast.success("Saved a copy to My Files.");
      }
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : e}`);
    }
  };

  const saveTemplate = async () => {
    const name = await prompt({
      title: "Save template",
      label: "Template name",
      placeholder: "e.g. Standard quote",
    });
    if (!name || !name.trim()) return;
    try {
      await quoteTemplates.create(name.trim(), tpl);
      loadTemplates();
      toast.success("Template saved.");
    } catch (e) {
      toast.error(
        `Could not save template: ${e instanceof Error ? e.message : e}`
      );
    }
  };

  const renderQuoteBody = () => {
    const customTemplate = tpl?.startsWith("custom-")
      ? loadCustomTemplates().find((ct) => ct.id === tpl)
      : null;

    if (customTemplate?.type === "file" && customTemplate.fileData) {
      const pw = customTemplate.paperSize === "Letter" ? 816 : 794;
      const ph = customTemplate.paperSize === "Letter" ? 1056 : 1122;
      const pos = customTemplate.positions || {};
      const ac = customTemplate.accent || accent;

      const Section = ({ k, children }: { k: string; children: React.ReactNode }) => {
        const p = pos[k];
        if (!p) return null;
        return (
          <div
            className="absolute bg-white/78 rounded-xl px-4 py-3 shadow-sm"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {children}
          </div>
        );
      };

      return (
        <div
          className="relative text-neutral-900 overflow-hidden"
          style={{ width: pw, minHeight: ph, background: "#fff" }}
        >
          <img
            src={customTemplate.fileData}
            alt="Template background"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ objectFit: "cover", opacity: 0.92 }}
          />

          <Section k="seller">
            {company?.logo && <img src={company.logo} alt="logo" style={{ height: 40 }} className="object-contain mb-1.5" />}
            <p className="font-bold text-sm text-neutral-900">{company?.name ?? "Your Company"}</p>
            <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{company?.address}</p>
            {company?.email && <p className="text-[9px] text-neutral-500 mt-0.5">{company.email}</p>}
          </Section>

          <Section k="header">
            <p className="text-2xl font-extrabold tracking-tight" style={{ color: ac }}>QUOTATION</p>
            <p className="text-xs font-mono text-neutral-800 mt-0.5">{number}</p>
            <p className="text-[10px] text-neutral-500 mt-0.5">{fmtDate(date)}</p>
            <p className="text-[10px] text-neutral-500">Valid Until: {fmtDate(valid)}</p>
          </Section>

          <Section k="customer">
            <p className="text-[9px] uppercase tracking-wider text-neutral-500 mb-0.5">Bill To</p>
            <p className="font-semibold text-xs text-neutral-900">{customer?.company || customer?.name || "Customer"}</p>
            <p className="text-[10px] text-neutral-600 whitespace-pre-line leading-tight">{customer?.address}</p>
            {customer?.email && <p className="text-[9px] text-neutral-500 mt-0.5">{customer.email}</p>}
          </Section>

          {pos.items && (
            <div
              className="absolute bg-white/82 rounded-xl p-4 shadow-sm overflow-auto"
              style={{ left: `${pos.items.x}%`, top: `${pos.items.y}%`, maxWidth: "90%" }}
            >
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ color: ac }} className="border-b-2 text-left">
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
                        <p className="font-semibold">{l.product || "—"}</p>
                        <p className="text-neutral-400">{l.sku}</p>
                      </td>
                      <td className="py-2 text-right">{l.qty}</td>
                      <td className="py-2 text-right">{m(l.rate)}</td>
                      <td className="py-2 text-right">{l.discount}%</td>
                      {vat && <td className="py-2 text-right">{l.tax}%</td>}
                      <td className="py-2 text-right font-semibold">{m(lineAmount(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pos.totals && (
            <div
              className="absolute bg-white/80 rounded-xl px-4 py-2.5 shadow-sm"
              style={{ left: `${pos.totals.x}%`, top: `${pos.totals.y}%` }}
            >
              <div className="text-xs">
                <Row k="Subtotal" v={m(totals.subtotal)} />
                <Row k="Discount" v={`-${m(totals.discount)}`} tone="text-green-600" />
                {vat && <Row k="Tax" v={m(totals.tax)} />}
                <div className="flex justify-between py-2 mt-1 font-bold text-sm" style={{ borderTop: `2px solid ${ac}`, color: ac }}>
                  <span>Total ({currency})</span>
                  <span>{m(totals.total)}</span>
                </div>
              </div>
            </div>
          )}

          <Section k="footer">
            <p className="text-[10px] text-neutral-600 whitespace-pre-line">{terms}</p>
          </Section>

          <div className="absolute bottom-2 right-2 z-20">
            <span className="text-[8px] text-neutral-400 bg-white/60 px-1.5 py-0.5 rounded-full">
              {customTemplate.name}
            </span>
          </div>
        </div>
      );
    }

    return (
    <>
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
          <p className="text-xs text-neutral-500 mt-1">{number}</p>
        </div>
      </div>

      <div className="flex justify-between mt-6 text-xs">
        <div>
          <p className="uppercase tracking-wide text-neutral-400">From</p>
          <p className="font-semibold text-sm mt-1">{company?.name}</p>
          <p className="text-neutral-500 whitespace-pre-line">
            {company?.address}
          </p>
          {company?.email && (
            <p className="text-neutral-500">{company.email}</p>
          )}
        </div>
        <div className="text-right">
          <p className="uppercase tracking-wide text-neutral-400">To</p>
          <p className="font-semibold text-sm mt-1">
            {customer?.company || customer?.name || "Customer"}
          </p>
          <p className="text-neutral-500 whitespace-pre-line">
            {customer?.address}
          </p>
          <p className="text-neutral-500 mt-2">Date: {fmtDate(date)}</p>
          <p className="text-neutral-500">Valid Until: {fmtDate(valid)}</p>
        </div>
      </div>

      <table className="w-full text-xs mt-6 border-collapse">
        <thead>
          <tr style={{ color: accent }} className="border-b-2 text-left">
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
                <p className="font-semibold">{l.product || "—"}</p>
                <p className="text-neutral-400">{l.sku}</p>
              </td>
              <td className="py-2 text-right">{l.qty}</td>
              <td className="py-2 text-right">{m(l.rate)}</td>
              <td className="py-2 text-right">{l.discount}%</td>
              {vat && <td className="py-2 text-right">{l.tax}%</td>}
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
    </>
  );
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-[28px] leading-9 font-bold text-ink">
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
          <button className="btn-ghost" aria-label="Save Draft" onClick={saveDraft}>
            <Save size={15} /> Save Draft
          </button>
          <button
            className="btn-ghost"
            aria-label="View quotation"
            onClick={() => setViewOpen(true)}
          >
            <Eye size={15} /> View
          </button>
          <button className="btn-ghost" aria-label="Download PDF" onClick={downloadQuotePdf}>
            <Download size={15} /> PDF
          </button>
          <button className="btn-ghost" aria-label="Email quotation" onClick={emailQuote}>
            <Send size={15} /> Email
          </button>
          {docId ? (
            <button
              className="btn-ghost"
              aria-label="Convert to Invoice"
              disabled={converting}
              onClick={async () => {
                setConverting(true);
                try {
                  await quotes.convertToInvoice(docId);
                  toast.success("Invoice created from quotation.");
                  navigate("/invoicing");
                } catch (e) {
                  toast.error(`Could not convert: ${errMsg(e)}`);
                } finally {
                  setConverting(false);
                }
              }}
            >
              <FileText size={15} />{" "}
              {converting ? "Converting…" : "Convert to Invoice"}
            </button>
          ) : null}
          <button className="btn-primary" aria-label="Generate PDF" onClick={downloadQuotePdf}>
            <Download size={15} /> Generate PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(340px,440px)] gap-5 items-start">
        {/* builder */}
        <div className="no-print space-y-4">
          <Step
            n={1}
            title="Choose Template"
            subtitle="Select a template for your quotation"
            action={
              <div className="flex items-center gap-2">
                {allTemplates.length > 4 && (
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setViewAll((v) => !v)}
                  >
                    {viewAll ? "Show less" : "View all templates"}
                  </button>
                )}
                <button
                  className="btn-ghost text-xs flex items-center gap-1"
                  onClick={() => setDesigning(true)}
                >
                  <Plus size={13} /> Create Template
                </button>
              </div>
            }
          >
            <div
              className={
                viewAll
                  ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                  : "flex gap-3 overflow-x-auto pb-1"
              }
            >
              {shownTemplates.map((t) => {
                const on = tpl === t.id;
                const isCustom = t.id.startsWith("custom-");
                const ct = isCustom ? customTemplates.find((c) => c.id === t.id) : null;
                const isFile = ct?.type === "file";
                return (
                  <button
                    key={t.id}
                    onClick={() => setTpl(t.id)}
                    className={`group relative shrink-0 w-32 rounded-xl border-2 p-2 text-left cursor-pointer transition-all ${
                      on
                        ? "border-primary-400 bg-primary-50 shadow-glow"
                        : "border-brand-200 bg-white hover:border-primary-300"
                    }`}
                  >
                    {on && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center z-10">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    {isCustom && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete template ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustomTpl(t.id, t.name);
                        }}
                        className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </span>
                    )}
                    <TemplateTilePreview templateId={t.id} customTemplates={customTemplates} />
                    <p className="text-xs font-semibold text-ink mt-2 flex items-center gap-1">
                      {t.name}
                      {isFile ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex items-center gap-0.5">
                          <Upload size={8} /> Uploaded
                        </span>
                      ) : isCustom ? (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-primary-100 text-primary-700 font-medium">Custom</span>
                      ) : null}
                    </p>
                  </button>
                );
              })}
            </div>
          </Step>

          <Step
            n={2}
            title="Quotation Details"
            subtitle="Add basic information for your quotation"
          >
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
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
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
          </Step>

          <Step
            n={3}
            title="Products"
            subtitle="Add products and their rates"
            action={
              <div className="flex items-center gap-2 flex-wrap">
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
                <button
                  type="button"
                  onClick={() => setShowBank((v) => !v)}
                  className={`btn-ghost text-xs ${showBank ? "!bg-primary-100 !text-primary-700" : ""}`}
                  title="Show your saved bank details on this quotation"
                >
                  <Landmark size={13} /> Bank: {showBank ? "On" : "Off"}
                </button>
                <button className="btn-ghost text-xs" onClick={addLine}>
                  <Plus size={13} /> Add Product
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-brand-400">
                    <th className="py-2 w-6">#</th>
                    <th className="py-2 px-2">Product</th>
                    <th className="py-2 px-2 w-24">SKU</th>
                    <th className="py-2 px-2 w-24 text-right">Qty</th>
                    <th className="py-2 px-2 w-28 text-right">Rate</th>
                    <th className="py-2 px-2 w-20 text-right">Disc%</th>
                    {vat && (
                      <th className="py-2 px-2 w-20 text-right">Tax%</th>
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
                          className="input text-right !px-2"
                          value={l.qty || ""}
                          placeholder="0"
                          onChange={(e) =>
                            setLine(i, { qty: numInput(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right !px-2"
                          placeholder="0"
                          value={l.rate || ""}
                          onChange={(e) =>
                            setLine(i, { rate: numInput(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          className="input text-right !px-2"
                          placeholder="0"
                          value={l.discount || ""}
                          onChange={(e) =>
                            setLine(i, { discount: numInput(e.target.value) })
                          }
                        />
                      </td>
                      {vat && (
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            className="input text-right !px-2"
                            placeholder="0"
                            value={l.tax || ""}
                            onChange={(e) =>
                              setLine(i, { tax: numInput(e.target.value) })
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
          </Step>

          <Step
            n={4}
            title="Stamp & Signature"
            subtitle="Upload your stamp and signature, then drag them onto the preview to position them. They appear on the PDF."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StampSigCard
                label="Stamp"
                icon={<Stamp size={15} />}
                value={stamp}
                onChange={setStamp}
                defaults={STAMP_DEFAULT}
              />
              <StampSigCard
                label="Signature"
                icon={<PenTool size={15} />}
                value={signature}
                onChange={setSignature}
                defaults={SIGN_DEFAULT}
              />
            </div>
          </Step>
        </div>

        {/* preview */}
        <div className="xl:sticky xl:top-2 space-y-4">
          {designing && (
            <TemplateDesigner
              onSave={(tpl) => {
                setCustomTemplates((prev) => [...prev, tpl]);
                setTpl(tpl.id);
                setDesigning(false);
              }}
              onClose={() => setDesigning(false)}
            />
          )}
          <div className="card !p-4">
            <div className="no-print flex items-center justify-between mb-3">
              <div>
                <p className="font-bold text-ink flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-ink text-white grid place-items-center text-xs font-bold">
                    5
                  </span>
                  Preview
                </p>
                <p className="text-xs text-brand-400 mt-0.5 ml-8">
                  This is how your quotation will look
                </p>
              </div>
            </div>
            <FitPreview
              baseWidth={device === "desktop" ? 794 : 420}
              zoom={zoom}
            >
              <div ref={quoteRef} className="relative">
                <StampSignatureLayer
                  stamp={stamp}
                  signature={signature}
                  onStampMove={(x, y) => setStamp((s) => (s ? { ...s, x, y } : s))}
                  onSignatureMove={(x, y) =>
                    setSignature((s) => (s ? { ...s, x, y } : s))
                  }
                />
                {renderQuoteBody()}
                {showBank && <BankDetailsBlock bank={bank} accent={accent} />}
              </div>
            </FitPreview>

            <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-xl bg-brand-50 p-1">
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "desktop"
                      ? "bg-primary-100 text-primary-700"
                      : "text-brand-400"
                  }`}
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                >
                  <Monitor size={15} />
                </button>
                <button
                  className={`rounded-lg p-1.5 cursor-pointer ${
                    device === "mobile"
                      ? "bg-primary-100 text-primary-700"
                      : "text-brand-400"
                  }`}
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile preview"
                >
                  <Smartphone size={15} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50"
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                  aria-label="Zoom out"
                >
                  <Minus size={14} />
                </button>
                <span className="text-xs font-semibold text-brand-600 w-10 text-center">
                  {zoom}%
                </span>
                <button
                  className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50"
                  onClick={() => setZoom((z) => Math.min(150, z + 10))}
                  aria-label="Zoom in"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          {viewOpen && (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4" onClick={() => setViewOpen(false)}>
              <div className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover outline-none" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-brand-100 dark:border-[#2A2C33] px-6 py-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-ink">
                      Quotation preview
                    </h2>
                    <span className="text-xs font-semibold text-brand-400 bg-brand-50 dark:bg-white/10 dark:text-brand-500 px-2 py-0.5 rounded-full">
                      Page 1 of {pageCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-ghost h-9 text-xs"
                      onClick={downloadQuotePdf}
                    >
                      <Download size={14} /> PDF
                    </button>
                    <button
                      onClick={() => setViewOpen(false)}
                      className="grid h-9 w-9 place-items-center rounded-xl text-brand-500 hover:bg-brand-100 hover:text-ink cursor-pointer"
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-6">
                  <div className="mx-auto max-w-5xl">
                    <div className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:border-[#3A3D45] dark:bg-white" ref={quotePreviewRef}>
                      <div className="relative">
                        <StampSignatureLayer
                          stamp={stamp}
                          signature={signature}
                          onStampMove={(x, y) =>
                            setStamp((s) => (s ? { ...s, x, y } : s))
                          }
                          onSignatureMove={(x, y) =>
                            setSignature((s) => (s ? { ...s, x, y } : s))
                          }
                        />
                        {renderQuoteBody()}
                        {showBank && <BankDetailsBlock bank={bank} accent={accent} />}
                      </div>
                    </div>
                    {pageCount > 1 && (
                      <p className="text-center text-xs text-brand-400 mt-3 font-medium">
                        Page 1 of {pageCount} — scroll to see all pages
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

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
          crm.customers().then(setCustomers).catch(() => toast.error("Failed to load customers"));
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

function Step({
  n,
  title,
  subtitle,
  action,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-xs font-bold shrink-0">
            {n}
          </span>
          <div>
            <p className="font-bold text-ink leading-tight">{title}</p>
            {subtitle && (
              <p className="text-xs text-brand-400 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
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
  const { toast } = useUI();
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
              toast.error(e instanceof Error ? e.message : "Failed to create customer");
              return;
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
  const { toast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) erp.products().then(setProducts).catch(() => toast.error("Failed to load products"));
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
