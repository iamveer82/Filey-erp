import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  ArrowLeft,
  Download,
  Save,
  Building2,
  Copy,
  Check,
  CheckCircle2,
  Pencil,
  Maximize2,
  Monitor,
  X,
} from "lucide-react";
import {
  receipts,
  billing,
  crm,
  type CompanyProfile,
  type CrmCustomer,
  type ReceiptDoc,
  type ReceiptSummary,
} from "../lib/api";
import { useUI } from "../lib/ui";
import { SelectMenu } from "../components/ui-menu";
import { fmtDate, money, CURRENCIES, errMsg, todayYmd, num } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import ColorPicker from "../components/ColorPicker";
import {
  pickDocNumber,
  loadDocFormats,
  type DocFormats,
} from "../lib/numberFormat";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import DocTemplateGallery from "../components/DocTemplateGallery";
import { startingTemplate } from "../components/DocPresetBar";
import CompanyModal from "../components/CompanyModal";
import TemplateDesigner, {
  loadCustomTemplates,
  syncCustomTemplates,
  type CustomTemplate,
} from "../components/TemplateDesigner";
import { StampSignatureLayer, type StampSig } from "../components/StampSignature";
import { loadCompanyStampSig, type CompanyStampSig } from "../components/StampSignatureSettings";
import FitPreview from "../components/FitPreview";
import ReceiptVoucher from "../components/ReceiptVoucher";
import DocView, { type DocViewForm } from "../components/DocView";
import { ResizablePanels } from "../components/ResizablePanels";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Badge,
  statusTone,
  Modal,
  Field,
  ShareToggle,
  SearchInput,
  FilterChip,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type ShareKind,
} from "../components/RowActions";
import { sendShareEmail } from "../lib/email";

const today = () => todayYmd();

type Form = Omit<ReceiptDoc, "id" | "created_at" | "updated_at" | "items"> & {
  id?: number;
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
};

function blankForm(
  c: CompanyProfile,
  existing: string[] = [],
  formats?: DocFormats
): Form {
  return {
    number: pickDocNumber("payment_receipt", existing, formats),
    status: "draft",
    // The dedicated voucher layout — receipts used to open on whatever the
    // company's invoice default was, which rendered them as invoices.
    template: "voucher",
    accent: c.default_accent || "#3E7C3A",
    currency: c.currency || "AED",
    logo: c.logo,
    seller_name: c.name,
    seller_address: c.address,
    seller_trn: c.trn,
    seller_email: c.email,
    seller_phone: c.phone,
    customer_name: "",
    customer_address: "",
    customer_trn: "",
    issue_date: today(),
    due_date: today(),
    notes: "Thank you for your business.",
    terms: "This receipt acknowledges the payment stated above.",
    amount: 0,
    amount_words: "",
    payment_method: "Cash",
    ref_number: "",
    for_description: "",
    tax_rate: 0,
    discount: 0,
    show_stamp: false,
    show_signature: false,
  };
}

const docViewForm = (form: Form | null): DocViewForm => {
  if (!form) return { template: "receipt", accent: "#222222", currency: "AED", items: [] };
  const notes = [
    form.notes,
    form.amount_words ? `Amount in words: ${form.amount_words}` : null,
    form.payment_method ? `Payment method: ${form.payment_method}` : null,
    form.ref_number ? `Reference #: ${form.ref_number}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    template: form.template || "receipt",
    accent: form.accent || "#222222",
    currency: form.currency || "AED",
    doc_title: "RECEIPT",
    number: form.number,
    logo: form.logo || null,
    seller_name: form.seller_name || null,
    seller_address: form.seller_address || null,
    seller_trn: form.seller_trn || null,
    seller_email: form.seller_email || null,
    seller_phone: form.seller_phone || null,
    customer_name: form.customer_name || null,
    customer_address: form.customer_address || null,
    customer_trn: form.customer_trn || null,
    customer_email: null,
    issue_date: form.issue_date || null,
    due_date: form.due_date || null,
    tax_rate: form.tax_rate ?? 0,
    discount: form.discount ?? 0,
    notes,
    notes_raw: form.notes || null,
    payment_method: form.payment_method || null,
    ref_number: form.ref_number || null,
    amount_words: form.amount_words || null,
    terms: form.terms || null,
    items: [
      {
        description: form.for_description || "Payment received",
        qty: 1,
        unit_price: form.amount || 0,
        unit: "",
      },
    ],
  };
};

export default function PaymentReceipt() {
  const { toast, confirm } = useUI();
  const confirmDelete = (title: string, message?: string) =>
    confirm({ title, message, danger: true });
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  // Saved number formats (Settings → Company Details → Document Numbering).
  const [docFmts, setDocFmts] = useState<DocFormats>({});
  useEffect(() => {
    loadDocFormats()
      .then(setDocFmts)
      .catch(() => {});
  }, []);
  const [docs, setDocs] = useState<ReceiptSummary[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [view, setView] = useState<"list" | "edit">("list");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [quickView, setQuickView] = useState<{ d: ReceiptSummary; doc: ReceiptDoc | null } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [zoom] = useState(100);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>({});
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([billing.getCompany(), receipts.list()]).then(([c, d]) => {
      setCompany(c);
      setDocs(d);
    });
    crm.customers().then(setCustomers).catch(() => {});
    loadCompanyStampSig().then(setCompanyStampSig).catch(() => {});
    syncCustomTemplates().then(setCustomTemplates).catch(() => {});
  }, []);

  const refreshList = async () => {
    const d = await receipts.list();
    setDocs(d);
  };

  const update = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  const newReceipt = async () => {
    if (!company) return;
    const f = blankForm(company, docs.map((d) => d.number), docFmts);
    // Receipts used to hardcode their template because default_template was
    // shared with invoices; the per-type preset gives them their own.
    f.template = await startingTemplate("receipt", company.default_template, f.template);
    setForm(f);
    setView("edit");
  };

  const loadDoc = async (id: number) => {
    try {
      const d = await receipts.get(id);
      const stampSig = await loadCompanyStampSig();
      setForm({
        ...d,
        stamp: stampSig.stamp,
        signature: stampSig.signature,
        show_stamp: d.show_stamp || false,
        show_signature: d.show_signature || false,
      });
      setView("edit");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error("Failed to load receipt: " + errMsg(e));
    }
  };

  const validate = () => {
    if (!form) return "No form";
    if (!form.customer_name) return "Received from is required.";
    if (!form.amount || form.amount <= 0) return "Amount must be greater than 0.";
    if (!form.issue_date) return "Payment date is required.";
    return null;
  };

  const save = async (): Promise<number | null> => {
    const error = validate();
    if (error) {
      toast.error(error);
      return null;
    }
    setSaving(true);
    try {
      const { stamp, signature, ...payload } = form!;
      const id = await receipts.save(payload as any);
      await refreshList();
      toast.success(`Receipt ${form!.number} saved.`);
      if (!form!.id) setForm((f) => f && { ...f, id });
      await archivePdf();
      return id;
    } catch (e) {
      toast.error("Save failed: " + errMsg(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const archivePdf = async () => {
    const base = `Receipt-${form?.number || "draft"}`;
    await withA4Sheet(async (el) => {
      await autoSaveDocument(`${base}.pdf`, "receipt", () => elementToPdfBytes(el, base));
    }).catch((e) => console.warn("Auto-archive failed", e));
  };

  const markStatus = async (status: string, idOverride?: number) => {
    const id = idOverride ?? form?.id;
    if (!id) {
      toast.error("Save the receipt first.");
      return;
    }
    await receipts.setStatus(id, status);
    update({ status });
    await refreshList();
    toast.success(`Receipt marked ${status}.`);
  };

  /** Finalize: save first when the receipt is still unsaved, then mark paid —
   *  the editor's primary action, same flow as invoicing's "Mark as done". */
  const finalize = async () => {
    const id = form?.id ?? (await save());
    if (!id) return;
    await markStatus("paid", id);
  };

  const duplicate = () => {
    const numbers = docs.map((d) => d.number);
    setForm({
      ...blankForm(company || ({} as any), numbers, docFmts),
      ...form,
      id: undefined,
      number: pickDocNumber("payment_receipt", numbers, docFmts),
      status: "draft",
      shared: false,
      share_token: undefined,
      issue_date: today(),
      due_date: today(),
    });
    toast.info("Receipt duplicated. Save to create a new copy.");
  };

  const share = async (shared: boolean) => {
    if (!form?.id) {
      toast.error("Save the receipt before sharing.");
      return;
    }
    await receipts.shareDoc(form.id, shared);
    update({ shared });
    await refreshList();
    toast.success(shared ? "Public link enabled." : "Public link disabled.");
  };

  const copyPublicLink = async () => {
    if (!form?.id) {
      toast.error("Save the receipt first.");
      return;
    }
    try {
      const token = await receipts.publicLink(form.id);
      const url = `${window.location.origin}/#/portal/${token}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      update({ shared: true, share_token: token });
      await refreshList();
    } catch (e) {
      toast.error("Could not create public link: " + errMsg(e));
    }
  };

  /** Clone the live preview onto a full A4 sheet parked off-screen and hand
   *  the sheet to `fn`. The exporter measures the node it is given, and the
   *  live preview is a scaled, min-heighted wrapper — capturing it directly
   *  produced cropped, odd-size PDFs. */
  const withA4Sheet = async (fn: (el: HTMLElement) => Promise<void>) => {
    const src = previewRef.current;
    if (!src) return;
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText =
      "position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;";
    const sheet = document.createElement("div");
    sheet.setAttribute("data-pdf-single", "true");
    sheet.style.cssText =
      "width:794px;min-height:1123px;background:#ffffff;box-sizing:border-box;";
    const content = src.cloneNode(true) as HTMLElement;
    content.style.minHeight = "1123px";
    sheet.appendChild(content);
    holder.appendChild(sheet);
    document.body.appendChild(holder);
    try {
      await fn(sheet);
    } finally {
      holder.remove();
    }
  };

  const downloadPdf = async () => {
    await withA4Sheet(async (el) => {
      await downloadElementAsPdf(el, `Receipt-${form?.number || "draft"}`);
    });
  };

  // Same shortcuts as the invoice editor: Ctrl+S save, Ctrl+P PDF.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        void downloadPdf();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  const remove = async (id: number) => {
    if (!(await confirmDelete("Delete this receipt?", "This cannot be undone."))) return;
    try {
      await receipts.delete(id);
      await refreshList();
      if (form?.id === id) {
        setForm(null);
        setView("list");
      }
      toast.success("Receipt deleted.");
    } catch (e) {
      toast.error("Delete failed: " + errMsg(e));
    }
  };

  // ---- List-row actions (DEMO parity) ----
  const openQuickView = (d: ReceiptSummary) => {
    setQuickView({ d, doc: null });
    receipts
      .get(d.id)
      .then((doc) => setQuickView((qv) => (qv && qv.d.id === d.id ? { d, doc } : qv)))
      .catch(() => toast.error("Failed to load receipt details"));
  };

  const findCustomer = (name: string) =>
    customers.find((c) => (c.company || c.name) === name);

  const shareReceipt = async (kind: ShareKind, d: ReceiptSummary) => {
    const cust = findCustomer(d.customer_name);
    const ccy = company?.currency || "AED";
    let url = `${location.origin}${location.pathname}#/payment-receipts`;
    try {
      const token = await receipts.publicLink(d.id);
      url = `${location.origin}${location.pathname}#/portal/${token}`;
      refreshList(); // publicLink flips the doc's shared flag
    } catch {
      /* fall back to the app link (e.g. Local mode) */
    }
    const text = `Receipt ${d.number} for ${money(d.amount || 0, ccy)} received. Thank you! View: ${url}`;
    if (kind === "email") {
      try {
        await sendShareEmail(cust?.email || "", `Receipt ${d.number}`, text);
        toast.success(`Receipt emailed to ${cust?.email}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    shareVia(kind, {
      phone: cust?.phone || "",
      email: cust?.email || "",
      text,
      url,
    });
    if (kind === "copyLink") toast.success("Public receipt link copied");
  };

  const duplicateRow = async (id: number) => {
    try {
      const d = await receipts.get(id);
      const numbers = docs.map((x) => x.number);
      setForm({
        ...blankForm(company || ({} as any), numbers, docFmts),
        ...d,
        id: undefined,
        number: pickDocNumber("payment_receipt", numbers, docFmts),
        status: "draft",
        shared: false,
        share_token: undefined,
        issue_date: today(),
        due_date: today(),
        show_stamp: d.show_stamp || false,
        show_signature: d.show_signature || false,
      });
      setView("edit");
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.info("Receipt duplicated. Save to create a new copy.");
    } catch (e) {
      toast.error("Duplicate failed: " + errMsg(e));
    }
  };

  /** Open the receipt in the editor and reuse the existing real PDF export. */
  const printReceipt = async (id: number) => {
    await loadDoc(id);
    // allow the editor preview to mount before rasterizing
    window.setTimeout(() => void downloadPdf(), 400);
  };

  const filtered = docs.filter((d) => {
    const q = search.toLowerCase();
    const matchQ =
      !q ||
      d.number.toLowerCase().includes(q) ||
      d.customer_name.toLowerCase().includes(q) ||
      (d.payment_method || "").toLowerCase().includes(q);
    const matchS = statusFilter === "all" || (d.status || "draft") === statusFilter;
    return matchQ && matchS;
  });

  const exportCsv = () =>
    downloadCsv(
      "payment-receipts",
      filtered.map((d) => ({
        number: d.number,
        customer_name: d.customer_name,
        date: fmtDate(d.payment_date),
        amount: money(d.amount, company?.currency || "AED"),
        status: d.status,
      })),
      [
        { key: "number", label: "Number" },
        { key: "customer_name", label: "Received From" },
        { key: "date", label: "Date" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Status" },
      ]
    );

  const statuses = Array.from(new Set(docs.map((d) => d.status || "draft"))).sort();

  const stats = {
    total: docs.length,
    amount: docs.reduce((s, d) => s + (d.amount || 0), 0),
    sent: docs.filter((d) => d.status === "sent").length,
    paid: docs.filter((d) => d.status === "paid").length,
    thisMonth: docs
      .filter((d) => (d.payment_date || "").slice(0, 7) === today().slice(0, 7))
      .reduce((s, d) => s + (d.amount || 0), 0),
  };
  const ccy = company?.currency || "AED";

  /** The rendered document (voucher layout or DocView) + stamp/signature
   *  overlay — shared by the live preview and the full-screen View modal. */
  const docContent = (f: Form) => (
    <>
      {f.template === "voucher" ? (
        <ReceiptVoucher
          sellerName={f.seller_name}
          sellerAddress={f.seller_address}
          sellerTrn={f.seller_trn}
          customerName={f.customer_name}
          customerAddress={f.customer_address}
          date={f.issue_date}
          reference={f.ref_number || f.number}
          paymentMode={f.payment_method}
          amount={f.amount}
          currency={f.currency || "AED"}
          accent={f.accent}
          amountWords={f.amount_words}
          forDescription={f.for_description}
          logo={f.logo}
        />
      ) : (
        <DocView
          form={docViewForm(f)}
          labels={{
            docTitle: "RECEIPT",
            partyLabel: "Received From",
            issuedLabel: "Date",
            dueLabel: "Date",
            totalLabel: "Amount Received",
          }}
        />
      )}
      <StampSignatureLayer
        stamp={
          f.show_stamp
            ? f.stamp?.data
              ? f.stamp
              : companyStampSig.stamp
            : undefined
        }
        signature={
          f.show_signature
            ? f.signature?.data
              ? f.signature
              : companyStampSig.signature
            : undefined
        }
        onStampMove={(x, y) => {
          const base = f.stamp?.data ? f.stamp : companyStampSig.stamp;
          if (base) update({ stamp: { ...base, x, y } });
        }}
        onSignatureMove={(x, y) => {
          const base = f.signature?.data ? f.signature : companyStampSig.signature;
          if (base) update({ signature: { ...base, x, y } });
        }}
      />
    </>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Payment Receipts"
        subtitle="Payments received against invoices"
        action={
          <div className="flex gap-2 flex-wrap">
            <button className="btn-ghost" aria-label="Export" onClick={exportCsv}>
              <Download size={14} /> Export
            </button>
            <button className="btn-primary" onClick={newReceipt}>
              <Plus size={16} /> Record payment
            </button>
          </div>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
            <MetricCard
              label="Total received"
              value={money(stats.amount, ccy)}
              change={`${num(stats.total)} receipts`}
              changeTone="up"
            />
            <MetricCard
              label="This month"
              value={money(stats.thisMonth, ccy)}
              change="Current period"
              changeTone="up"
            />
            <MetricCard
              label="Sent"
              value={String(stats.sent)}
              change={stats.sent > 0 ? "With the payer" : "None"}
              changeTone="up"
            />
            <MetricCard
              label="Paid"
              value={String(stats.paid)}
              change={stats.paid > 0 ? "Confirmed payments" : "None yet"}
              changeTone={stats.paid > 0 ? "up" : "warn"}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search receipt, payer or method…"
              className="max-w-xs"
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} count={docs.length}>
                All
              </FilterChip>
              {statuses.map((s) => (
                <FilterChip
                  key={s}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                  count={docs.filter((d) => (d.status || "draft") === s).length}
                >
                  {s}
                </FilterChip>
              ))}
            </div>
          </div>

          {/* DataTable draws its own card - the extra wrapper here was the
              reason receipts looked boxed-in next to the other sections. */}
          <DataTable
              pageSize={10}
              columns={[
                { key: "number", label: "Number", render: (d) => <span className="font-medium text-ink">{d.number}</span> },
                { key: "customer_name", label: "Received From", render: (d) => d.customer_name || "—" },
                { key: "payment_date", label: "Date", render: (d) => fmtDate(d.payment_date) },
                { key: "payment_method", label: "Method", render: (d) => d.payment_method || "—" },
                {
                  key: "amount",
                  label: "Amount",
                  render: (d) => money(d.amount, company?.currency || "AED"),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge>,
                },
                {
                  key: "shared",
                  label: "Public",
                  render: (d) =>
                    d.shared ? <Badge tone="success">Shared</Badge> : <Badge tone="neutral">Private</Badge>,
                },
                {
                  key: "actions",
                  label: "Actions",
                  render: (d) => (
                    <RowActions
                      onView={() => openQuickView(d)}
                      onEdit={() => loadDoc(d.id)}
                      onCopy={() => duplicateRow(d.id)}
                      onDelete={() => remove(d.id)}
                      onSend={{
                        whatsapp: () => shareReceipt("whatsapp", d),
                        email: () => shareReceipt("email", d),
                        sms: () => shareReceipt("sms", d),
                        copyLink: () => shareReceipt("copyLink", d),
                      }}
                    />
                  ),
                },
              ]}
              rows={filtered}
              rowKey={(d: ReceiptSummary) => d.id}
              onRowClick={(d) => loadDoc(d.id)}
              empty={
                search || statusFilter !== "all"
                  ? "No receipts match your filters."
                  : "No receipts yet."
              }
            />

          <QuickViewModal
            open={!!quickView}
            onClose={() => setQuickView(null)}
            onEdit={
              quickView
                ? () => {
                    const id = quickView.d.id;
                    setQuickView(null);
                    loadDoc(id);
                  }
                : undefined
            }
            onPrint={
              quickView
                ? () => {
                    const id = quickView.d.id;
                    setQuickView(null);
                    printReceipt(id);
                  }
                : undefined
            }
            data={
              quickView
                ? {
                    title: `Receipt ${quickView.d.number}`,
                    subtitle: `From ${quickView.d.customer_name || "—"}`,
                    badge: (
                      <Badge tone={statusTone(quickView.doc?.status || quickView.d.status)}>
                        {quickView.doc?.status || quickView.d.status}
                      </Badge>
                    ),
                    meta: [
                      { label: "Payer", value: quickView.d.customer_name },
                      { label: "Date", value: fmtDate(quickView.d.payment_date) },
                      { label: "Method", value: quickView.doc?.payment_method || "—" },
                      { label: "Reference", value: quickView.doc?.ref_number || "—" },
                      {
                        label: "Currency",
                        value: quickView.doc?.currency || company?.currency || "AED",
                      },
                    ],
                    items: [
                      {
                        desc:
                          quickView.doc?.for_description ||
                          `Payment received${quickView.doc?.payment_method ? ` (${quickView.doc.payment_method})` : ""}`,
                        qty: 1,
                        price: Number(quickView.doc?.amount ?? quickView.d.amount) || 0,
                      },
                    ],
                    total: Number(quickView.doc?.amount ?? quickView.d.amount) || 0,
                    currency: quickView.doc?.currency || company?.currency || "AED",
                    notes: quickView.doc?.notes || undefined,
                  }
                : null
            }
          />
        </>
      ) : (
        <>
          {!form ? (
            <div className="mt-4 text-sm text-brand-500">Loading editor…</div>
          ) : (
            <>
              {/* Header bar — same layout as the invoice editor: back arrow,
                  title, then status + actions right-aligned. */}
              <div className="no-print mt-4 flex items-start justify-between mb-6 gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <button
                    className="rounded-xl p-2.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer mt-0.5"
                    onClick={() => {
                      setForm(null);
                      setView("list");
                    }}
                    aria-label="Back"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h1 className="text-[22px] font-semibold text-foreground tracking-tight">
                      {form.id ? "Edit Receipt" : "Record Payment"}
                    </h1>
                    <p className="text-sm text-brand-500 mt-0.5">
                      Money received - a receipt the payer can file
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={statusTone(form.status)}>{form.status}</Badge>
                  {!form.id && (
                    <span className="text-xs font-medium text-brand-400">Unsaved</span>
                  )}
                  <button className="btn-ghost" onClick={() => setViewOpen(true)}>
                    <Maximize2 size={15} /> View
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={downloadPdf}
                    title="Download PDF (Ctrl+P)"
                  >
                    <Download size={15} /> PDF
                  </button>
                  <button className="btn-ghost" onClick={duplicate} title="Duplicate as a new draft">
                    <Copy size={15} /> Duplicate
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => void save()}
                    disabled={saving}
                    title="Save (Ctrl+S)"
                  >
                    <Save size={15} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => setCompanyOpen(true)}
                    title="Edit company details & default template"
                  >
                    <Building2 size={15} /> Company
                  </button>
                  {form.status === "paid" ? (
                    <button
                      className="btn-ghost"
                      onClick={() => void markStatus("draft")}
                      disabled={saving}
                      title="Move this receipt back to draft"
                    >
                      <Pencil size={15} /> Move to draft
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      onClick={finalize}
                      disabled={saving}
                      title={form.id ? "Mark this receipt as paid" : "Save and mark paid"}
                    >
                      <CheckCircle2 size={15} /> Mark paid
                    </button>
                  )}
                  <button
                    className="btn-ghost"
                    onClick={copyPublicLink}
                    title="Copy a public link to this receipt"
                  >
                    {shareCopied ? <Check size={15} /> : <Monitor size={15} />} Copy link
                  </button>
                  <ShareToggle shared={!!form.shared} onToggle={share} />
                </div>
              </div>

              <ResizablePanels
                left={
                  <div className="space-y-6">
                    <DocTemplateGallery
                      key={customTemplates.length}
                      value={form.template || "receipt"}
                      onChange={(id) => update({ template: id })}
                      onDesign={() => setTemplateOpen(true)}
                      docType="receipt"
                      viewAll={false}
                    />

                    <div className="card p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-ink">Receipt details</h3>
                        <div className="flex items-center gap-2">
                          <ColorPicker value={form.accent || "#222222"} onChange={(v) => update({ accent: v })} />
                          <button
                            className="btn-ghost"
                            onClick={() => setCompanyOpen(true)}
                            title="Company profile"
                          >
                            <Building2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Receipt number">
                          <input
                            className="input"
                            value={form.number}
                            onChange={(e) => update({ number: e.target.value })}
                          />
                        </Field>
                        <Field label="Payment date">
                          <DateField
                            value={form.issue_date}
                            onChange={(v) => update({ issue_date: v, due_date: v })}
                            clearable={false}
                          />
                        </Field>
                      </div>

                      <Field label="Received from (payer)">
                        <input
                          className="input"
                          value={form.customer_name}
                          onChange={(e) => update({ customer_name: e.target.value })}
                        />
                      </Field>
                      <Field label="Payer address">
                        <textarea
                          className="textarea"
                          rows={3}
                          value={form.customer_address || ""}
                          onChange={(e) => update({ customer_address: e.target.value })}
                        />
                      </Field>
                      <Field label="Payment for">
                        <input
                          className="input"
                          value={form.for_description || ""}
                          onChange={(e) => update({ for_description: e.target.value })}
                        />
                      </Field>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Currency">
                          <SelectMenu
                            value={form.currency || "AED"}
                            onChange={(v) => update({ currency: v })}
                            options={CURRENCIES.map((c) => ({
                              value: c.code,
                              label: `${c.code} - ${c.name}`,
                            }))}
                          />
                        </Field>
                        <Field label="Amount">
                          <input
                            className="input"
                            type="number"
                            value={form.amount}
                            onChange={(e) => update({ amount: Number(e.target.value) || 0 })}
                          />
                        </Field>
                        <Field label="Amount in words">
                          <input
                            className="input"
                            value={form.amount_words || ""}
                            onChange={(e) => update({ amount_words: e.target.value })}
                          />
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Payment method">
                          <input
                            className="input"
                            value={form.payment_method || ""}
                            onChange={(e) => update({ payment_method: e.target.value })}
                          />
                        </Field>
                        <Field label="Reference number">
                          <input
                            className="input"
                            value={form.ref_number || ""}
                            onChange={(e) => update({ ref_number: e.target.value })}
                          />
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Notes">
                          <textarea
                            className="textarea"
                            rows={3}
                            value={form.notes || ""}
                            onChange={(e) => update({ notes: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>

                    <div className="card p-4 space-y-4">
                      <h3 className="text-sm font-semibold text-ink">Seller / company</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Company name">
                          <input
                            className="input"
                            value={form.seller_name || ""}
                            onChange={(e) => update({ seller_name: e.target.value })}
                          />
                        </Field>
                        <Field label="TRN">
                          <input
                            className="input"
                            value={form.seller_trn || ""}
                            onChange={(e) => update({ seller_trn: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Field label="Address">
                        <textarea
                          className="textarea"
                          rows={3}
                          value={form.seller_address || ""}
                          onChange={(e) => update({ seller_address: e.target.value })}
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Email">
                          <input
                            className="input"
                            value={form.seller_email || ""}
                            onChange={(e) => update({ seller_email: e.target.value })}
                          />
                        </Field>
                        <Field label="Phone">
                          <input
                            className="input"
                            value={form.seller_phone || ""}
                            onChange={(e) => update({ seller_phone: e.target.value })}
                          />
                        </Field>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={!!form.show_stamp}
                          onChange={(e) => update({ show_stamp: e.target.checked })}
                        />
                        Show company stamp
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={!!form.show_signature}
                          onChange={(e) => update({ show_signature: e.target.checked })}
                        />
                        Show authorised signature
                      </label>
                    </div>
                  </div>
                }
                right={
                  <FitPreview baseWidth={794} zoom={zoom} padding={0}>
                    {/* ponytail: keep receipt preview + PDF English regardless of app lang */}
                    <div ref={previewRef} data-no-i18n dir="ltr">
                      <div style={{ position: "relative", minHeight: 1027 }}>
                        {docContent(form!)}
                      </div>
                    </div>
                  </FitPreview>
                }
              />

              {company && (
                <CompanyModal
                  open={companyOpen}
                  docType="receipt"
                  company={company}
                  onClose={() => setCompanyOpen(false)}
                  onSaved={(c) => {
                    setCompany(c);
                    setCompanyOpen(false);
                  }}
                />
              )}

              {/* Full-screen view modal — same pattern as the invoice editor.
                  Portaled out of <main>'s scrolling subtree: WebView2
                  half-paints a `fixed` overlay that stays inside it. */}
              {viewOpen &&
                createPortal(
                  <div
                    className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4"
                    onClick={() => setViewOpen(false)}
                  >
                    <div
                      className="flex max-h-[95vh] w-full max-w-7xl flex-col rounded-xl bg-card border border-border outline-none shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-brand-100 px-6 py-4">
                        <div className="flex items-center gap-3">
                          <h2 className="text-lg font-semibold text-ink">
                            {form.number || "Receipt preview"}
                          </h2>
                          <span className="text-xs font-semibold text-brand-500 bg-brand-50 dark:bg-white/10 dark:text-brand-500 px-2.5 py-1 rounded-full">
                            Receipt
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="btn-ghost h-9 text-xs" onClick={() => void downloadPdf()}>
                            <Download size={14} /> PDF
                          </button>
                          <button
                            onClick={() => setViewOpen(false)}
                            className="grid h-9 w-9 place-items-center rounded-xl text-brand-500 hover:bg-brand-50 hover:text-ink cursor-pointer transition-colors"
                            aria-label="Close"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-auto p-6">
                        <div className="mx-auto max-w-5xl">
                          <div
                            data-no-i18n
                            dir="ltr"
                            className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:bg-white min-h-[1123px]"
                          >
                            <div style={{ position: "relative", minHeight: 1059 }}>
                              {docContent(form!)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              <Modal
                open={templateOpen}
                onClose={() => {
                  setTemplateOpen(false);
                  syncCustomTemplates().then(setCustomTemplates).catch(() => {});
                }}
                title="Template designer"
                size="xl"
              >
                <TemplateDesigner
                  onSave={(tpl) => {
                    update({ template: tpl.id });
                    setTemplateOpen(false);
                    syncCustomTemplates().then(setCustomTemplates).catch(() => {});
                  }}
                  onClose={() => {
                    setTemplateOpen(false);
                    syncCustomTemplates().then(setCustomTemplates).catch(() => {});
                  }}
                />
              </Modal>
            </>
          )}
        </>
      )}
    </div>
  );
}
