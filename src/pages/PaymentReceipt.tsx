import { useEffect, useRef, useState } from "react";
import {
  Plus,
  ArrowLeft,
  Download,
  Save,
  Building2,
  Copy,
  Check,
  Send,
  Monitor,
  PenTool,
  Trash2,
  FileText,
  Wallet,
} from "lucide-react";
import {
  receipts,
  billing,
  type CompanyProfile,
  type ReceiptDoc,
  type ReceiptSummary,
} from "../lib/api";
import { useUI } from "../lib/ui";
import { fmtDate, money, CURRENCIES, errMsg } from "../lib/format";
import ColorPicker from "../components/ColorPicker";
import { nextDocNumber } from "../lib/docNumber";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import DocTemplateGallery from "../components/DocTemplateGallery";
import TemplateDesigner, {
  loadCustomTemplates,
  syncCustomTemplates,
  type CustomTemplate,
} from "../components/TemplateDesigner";
import { StampSignatureLayer, type StampSig } from "../components/StampSignature";
import { loadCompanyStampSig, type CompanyStampSig } from "../components/StampSignatureSettings";
import FitPreview from "../components/FitPreview";
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
} from "../components/ui";
import { DateField } from "../components/DatePicker";

const today = () => new Date().toISOString().slice(0, 10);

type Form = Omit<ReceiptDoc, "id" | "created_at" | "updated_at" | "items"> & {
  id?: number;
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
};

function blankForm(c: CompanyProfile, existing: string[] = []): Form {
  return {
    number: nextDocNumber({ prefix: "REC", existing }),
    status: "draft",
    template: "receipt",
    accent: c.default_accent || "#222222",
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
  const [docs, setDocs] = useState<ReceiptSummary[]>([]);
  const [view, setView] = useState<"list" | "edit">("list");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates());
  const [search, setSearch] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [zoom] = useState(100);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>({});
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([billing.getCompany(), receipts.list()]).then(([c, d]) => {
      setCompany(c);
      setDocs(d);
    });
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

  const applyCompanyDefaults = () => {
    if (!company) return;
    update({
      logo: company.logo,
      seller_name: company.name,
      seller_address: company.address,
      seller_trn: company.trn,
      seller_email: company.email,
      seller_phone: company.phone,
    });
  };

  const newReceipt = () => {
    if (!company) return;
    setForm(blankForm(company, docs.map((d) => d.number)));
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

  const save = async () => {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      const { stamp, signature, ...payload } = form!;
      const id = await receipts.save(payload as any);
      await refreshList();
      toast.success(`Receipt ${form!.number} saved.`);
      if (!form!.id) setForm((f) => f && { ...f, id });
      await archivePdf();
    } catch (e) {
      toast.error("Save failed: " + errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const archivePdf = async () => {
    const el = previewRef.current;
    if (!el) return;
    try {
      const base = `Receipt-${form?.number || "draft"}`;
      await autoSaveDocument(`${base}.pdf`, "receipt", () => elementToPdfBytes(el, base));
    } catch (e) {
      console.warn("Auto-archive failed", e);
    }
  };

  const markStatus = async (status: string) => {
    if (!form?.id) {
      toast.error("Save the receipt first.");
      return;
    }
    await receipts.setStatus(form.id, status);
    update({ status });
    await refreshList();
    toast.success(`Receipt marked ${status}.`);
  };

  const duplicate = () => {
    const numbers = docs.map((d) => d.number);
    setForm({
      ...blankForm(company || ({} as any), numbers),
      ...form,
      id: undefined,
      number: nextDocNumber({ prefix: "REC", existing: numbers }),
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

  const downloadPdf = () => {
    const el = previewRef.current;
    if (!el) return;
    try {
      downloadElementAsPdf(el, `Receipt-${form?.number || "draft"}`);
    } catch (e) {
      toast.error("PDF export failed: " + errMsg(e));
    }
  };

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

  const filtered = docs.filter(
    (d) =>
      d.number.toLowerCase().includes(search.toLowerCase()) ||
      d.customer_name.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: docs.length,
    amount: docs.reduce((s, d) => s + (d.amount || 0), 0),
    sent: docs.filter((d) => d.status === "sent").length,
    paid: docs.filter((d) => d.status === "paid").length,
  };

  return (
    <div className="p-6">
      <PageHeader title="Payment Receipts" />

      {view === "list" ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total receipts" value={String(stats.total)} icon={<FileText size={18} />} />
            <MetricCard label="Total received" value={money(stats.amount, company?.currency || "AED")} icon={<Wallet size={18} />} />
            <MetricCard label="Sent" value={String(stats.sent)} icon={<Send size={18} />} />
            <MetricCard label="Paid" value={String(stats.paid)} icon={<Check size={18} />} />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput value={search} onChange={setSearch} placeholder="Search receipts…" />
            <button className="btn-primary flex items-center gap-2" onClick={newReceipt}>
              <Plus size={16} /> New Receipt
            </button>
          </div>

          <div className="mt-4 card">
            <DataTable
              columns={[
                { key: "number", label: "Number", render: (d) => <span className="font-medium text-ink">{d.number}</span> },
                { key: "customer_name", label: "Received From", render: (d) => d.customer_name || "—" },
                { key: "payment_date", label: "Date", render: (d) => fmtDate(d.payment_date) },
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
                  label: "",
                  render: (d) => (
                    <div className="flex gap-2 justify-end">
                      <button className="btn-ghost" onClick={() => loadDoc(d.id)}>
                        <PenTool size={14} />
                      </button>
                      <button className="btn-ghost text-danger" onClick={() => remove(d.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ),
                },
              ]}
              rows={filtered}
              rowKey={(d: ReceiptSummary) => d.id}
              empty="No receipts yet."
            />
          </div>
        </>
      ) : (
        <>
          {!form ? (
            <div className="mt-4 text-sm text-brand-500">Loading editor…</div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="btn-ghost flex items-center gap-1.5"
                  onClick={() => {
                    setForm(null);
                    setView("list");
                  }}
                >
                  <ArrowLeft size={14} /> Back to list
                </button>
                <button className="btn-primary flex items-center gap-1.5" onClick={save} disabled={saving}>
                  <Save size={14} /> {saving ? "Saving…" : "Save"}
                </button>
                <button className="btn-secondary flex items-center gap-1.5" onClick={downloadPdf}>
                  <Download size={14} /> PDF
                </button>
                <button className="btn-secondary flex items-center gap-1.5" onClick={duplicate}>
                  <Copy size={14} /> Duplicate
                </button>
                <button
                  className="btn-secondary flex items-center gap-1.5"
                  onClick={() => markStatus(form.status === "paid" ? "sent" : "paid")}
                >
                  <Check size={14} /> {form.status === "paid" ? "Mark Sent" : "Mark Paid"}
                </button>
                <button className="btn-secondary flex items-center gap-1.5" onClick={copyPublicLink}>
                  {shareCopied ? <Check size={14} /> : <Monitor size={14} />} Copy link
                </button>
                <ShareToggle shared={!!form.shared} onToggle={share} />
              </div>

              <ResizablePanels
                left={
                  <div className="space-y-6">
                    <DocTemplateGallery
                      key={customTemplates.length}
                      value={form.template || "receipt"}
                      onChange={(id) => update({ template: id })}
                      onDesign={() => setTemplateOpen(true)}
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
                        <Field label="Currency">
                          <select
                            className="select"
                            value={form.currency || "AED"}
                            onChange={(e) => update({ currency: e.target.value })}
                          >
                            {CURRENCIES.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} — {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
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
                    <div ref={previewRef}>
                      <div style={{ position: "relative", minHeight: 1027 }}>
                        <DocView
                          form={docViewForm(form)}
                          labels={{
                            docTitle: "RECEIPT",
                            partyLabel: "Received From",
                            issuedLabel: "Date",
                            dueLabel: "Date",
                            totalLabel: "Amount Received",
                          }}
                        />
                        <StampSignatureLayer
                          stamp={
                            form.show_stamp
                              ? form.stamp?.data
                                ? form.stamp
                                : companyStampSig.stamp
                              : undefined
                          }
                          signature={
                            form.show_signature
                              ? form.signature?.data
                                ? form.signature
                                : companyStampSig.signature
                              : undefined
                          }
                          onStampMove={(x, y) => {
                            const base = form.stamp?.data ? form.stamp : companyStampSig.stamp;
                            if (base) update({ stamp: { ...base, x, y } });
                          }}
                          onSignatureMove={(x, y) => {
                            const base = form.signature?.data ? form.signature : companyStampSig.signature;
                            if (base) update({ signature: { ...base, x, y } });
                          }}
                        />
                      </div>
                    </div>
                  </FitPreview>
                }
              />

              <Modal open={companyOpen} onClose={() => setCompanyOpen(false)} title="Company profile">
                <div className="space-y-4">
                  <p className="text-sm text-brand-500">
                    Update company details from Settings &gt; Organization. Use the button below to apply defaults to this receipt.
                  </p>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      applyCompanyDefaults();
                      setCompanyOpen(false);
                    }}
                  >
                    Apply company defaults
                  </button>
                </div>
              </Modal>

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
