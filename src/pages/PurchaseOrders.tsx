import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Download,
  Save,
  Building2,
  Upload,
  X,
  Pencil,
  Copy,
  Monitor,
  Smartphone,
  Minus,
  Stamp,
  PenTool,
  CreditCard,
  PackageCheck,
  SeparatorHorizontal,
  Truck,
  ClipboardList,
  Wallet,
  Send,
  Landmark,
} from "lucide-react";
import {
  pos,
  suppliers as suppliersApi,
  erp,
  billing,
  type PoSummary,
  type PoInput,
  type PoPayment,
  type PurchaseOrder,
  type Supplier,
  type CompanyProfile,
  type Product,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, fmtDate, money, num, numInput, CURRENCIES, errMsg, todayYmd } from "../lib/format";
import {
  docLineAmount,
  docTotals,
  storedLineAmount,
  paginateItems,
  splitPageBreak,
  mergePageBreak,
  sanitizeCustomColumns,
  RESERVED_ITEM_COLUMNS,
  type DocItem,
} from "../lib/docItems";
import {
  pickDocNumber,
  loadDocFormats,
  type DocFormats,
} from "../lib/numberFormat";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf, elementToPdfBytes } from "../lib/pdfTools";
import { autoSaveDocument } from "../lib/files";
import ColorPicker from "../components/ColorPicker";
import CompanyModal from "../components/CompanyModal";
import DocPresetBar, { startingTemplate } from "../components/DocPresetBar";
import DocTemplateGallery from "../components/DocTemplateGallery";
import TemplateDesigner, { type CustomTemplate } from "../components/TemplateDesigner";
import {
  StampSignatureLayer,
  StampSigAdjust,
  DraggableBlock,
  type StampSig,
} from "../components/StampSignature";
import {
  BankDetailsBlock,
  loadBankInfo,
  hasBankInfo,
  EMPTY_BANK,
  type BankInfo,
} from "../components/BankDetails";
import {
  loadCompanyStampSig,
  EMPTY_STAMP_SIG,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import { ResizablePanels } from "../components/ResizablePanels";
import DocView from "../components/DocView";
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
  ToggleTile,
} from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
  type ShareKind,
} from "../components/RowActions";
import { sendShareEmail } from "../lib/email";
import { DateField } from "../components/DatePicker";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CustomColumn = { key: string; label: string };

type Item = {
  product_id?: number;
  description: string;
  quantity: number;
  unit_cost: number;
  unit: string;
  custom: Record<string, string>;
  pageBreakBefore?: boolean;
};

type Form = Omit<PoInput, "items"> & {
  items: Item[];
  customColumns: CustomColumn[];
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
  show_bank?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const today = () => todayYmd();

function blankForm(
  c: CompanyProfile,
  existing: string[] = [],
  formats?: DocFormats
): Form {
  return {
    po_number: pickDocNumber("purchase_order", existing, formats),
    status: "draft",
    total: 0,
    doc_title: "Purchase Order",
    template: c.default_template || "minimal",
    accent: c.default_accent || "#222222",
    currency: c.currency || "AED",
    seller_name: c.name,
    seller_address: c.address,
    seller_trn: c.trn,
    seller_email: c.email,
    seller_phone: c.phone,
    logo: c.logo,
    supplier_id: undefined,
    supplier_name: "",
    supplier_address: "",
    supplier_trn: "",
    supplier_email: "",
    supplier_phone: "",
    order_date: today(),
    expected_date: undefined,
    notes: "Thank you for your business.",
    terms: "Payment due within 30 days of invoice.",
    tax_rate: 0,
    discount: 0,
    items: [
      {
        description: "",
        quantity: 1,
        unit_cost: 0,
        unit: "",
        custom: {},
        pageBreakBefore: false,
      },
    ],
    customColumns: [],
    show_stamp: false,
    show_signature: false,
    show_bank: false,
    unit_price_formula: null,
  };
}

const toDocItem = (it: Item): DocItem => ({
  description: it.description,
  qty: it.quantity,
  unit_price: it.unit_cost,
  custom: it.custom,
  pageBreakBefore: it.pageBreakBefore,
});

const normStamp = (
  v: Partial<StampSig> | null | undefined,
  def?: StampSig
): StampSig | undefined => {
  if (!v || !v.data) return undefined;
  return {
    data: v.data,
    x: v.x ?? def?.x ?? 60,
    y: v.y ?? def?.y ?? 60,
    opacity: v.opacity ?? def?.opacity ?? 1,
    color: v.color ?? def?.color ?? "#000000",
    cropTop: v.cropTop ?? 0,
    cropRight: v.cropRight ?? 0,
    cropBottom: v.cropBottom ?? 0,
    cropLeft: v.cropLeft ?? 0,
    scale: v.scale ?? def?.scale ?? 1,
  };
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function PurchaseOrders() {
  const { toast, confirm } = useUI();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  // Saved number formats (Settings → Company Details → Document Numbering).
  const [docFmts, setDocFmts] = useState<DocFormats>({});
  useEffect(() => {
    loadDocFormats()
      .then(setDocFmts)
      .catch(() => {});
  }, []);
  const [rows, setRows] = useState<PoSummary[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [payFor, setPayFor] = useState<PoSummary | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "sent" | "received" | "cancelled"
  >("all");
  // DEMO parity: quick-view modal payload (+ PO id for its Edit action).
  const [quickView, setQuickView] = useState<{
    id: number;
    data: QuickViewData;
  } | null>(null);
  const [tplRev, setTplRev] = useState(0);

  const loadRows = () =>
    pos
      .list()
      .then(setRows)
      .catch((e) => {
        setError(`Could not load purchase orders: ${errMsg(e)}`);
        toast.error("Failed to load purchase orders");
      })
      .finally(() => setLoading(false));

  const reload = () => {
    billing
      .getCompany()
      .then(setCompany)
      .catch(() => toast.error("Failed to load company profile"));
    loadRows();
  };

  useEffect(reload, []);
  useLiveSync(reload);

  // ⌘K deep-link: ?new=1 opens a blank PO once company is loaded.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1" && company && !form) {
      setForm(blankForm(company, rows.map((r) => r.po_number), docFmts));
      setParams({}, { replace: true });
    }
  }, [params, company, form, setParams, rows]);

  const newPo = async () => {
    if (!company) return;
    const f = blankForm(company, rows.map((r) => r.po_number), docFmts);
    // The section's preset wins over the profile-wide default template.
    f.template = await startingTemplate("po", company.default_template, f.template);
    setForm(f);
  };

  const onSaved = () => loadRows();

  if (form) {
    return (
      <>
        {company && (
          <CompanyModal
            open={companyOpen}
            company={company}
            onClose={() => setCompanyOpen(false)}
            onSaved={(c) => {
              setCompany(c);
              setForm((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  seller_name: c.name,
                  seller_address: c.address ?? prev.seller_address,
                  seller_trn: c.trn ?? prev.seller_trn,
                  seller_email: c.email ?? prev.seller_email,
                  seller_phone: c.phone ?? prev.seller_phone,
                  logo: c.logo ?? prev.logo,
                };
              });
            }}
          />
        )}
        <Editor
          form={form}
          setForm={setForm}
          rows={rows}
          company={company}
          onBack={() => {
            setForm(null);
            loadRows();
          }}
          onSaved={onSaved}
          docFmts={docFmts}
          onEditCompany={() => setCompanyOpen(true)}
          tplRev={tplRev}
          onTplRev={() => setTplRev((v) => v + 1)}
        />
      </>
    );
  }

  const statCcy = company?.currency || "AED";
  const totalValue = rows.reduce((s, r) => s + r.total, 0);
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const receivedCount = rows.filter((r) => r.status === "received").length;

  const filtered = rows
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) =>
      search
        ? r.po_number.toLowerCase().includes(search.toLowerCase()) ||
          r.supplier_name.toLowerCase().includes(search.toLowerCase())
        : true
    );

  // ----- DEMO parity: quick view, per-row send/share, duplicate -----

  // Fetch the full PO (cached) and show the DEMO-style quick-view modal:
  // meta grid + line items + total + notes.
  const openQuickView = async (r: PoSummary) => {
    try {
      const doc = await pos.get(r.id);
      const ccy = doc.currency || r.currency || statCcy;
      setQuickView({
        id: r.id,
        data: {
          title: `${doc.doc_title || "Purchase Order"} ${doc.po_number}`,
          subtitle: `Supplier: ${doc.supplier_name || r.supplier_name}`,
          badge: <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
          meta: [
            { label: "Supplier", value: doc.supplier_name || r.supplier_name },
            { label: "Order date", value: fmtDate(r.order_date) },
            {
              label: "Expected",
              value: r.expected_date ? fmtDate(r.expected_date) : "—",
            },
            { label: "Currency", value: ccy },
            { label: "Items", value: num(doc.items.length) },
            { label: "Status", value: r.status },
          ],
          items: doc.items.map((i) => ({
            desc: i.description,
            qty: i.quantity,
            price: i.unit_cost,
            amount: storedLineAmount(
              { qty: i.quantity, unit_price: i.unit_cost, custom: i.custom },
              doc.unit_price_formula
            ),
          })),
          total: r.total,
          currency: ccy,
          notes: doc.notes,
        },
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Share one PO via WhatsApp / email / SMS, or copy its public portal link
  // (same real link as the bulk "Copy public link" action).
  const sendPo = async (kind: ShareKind, r: PoSummary) => {
    try {
      if (kind === "copyLink") {
        const token = await pos.publicLink(r.id);
        const url = `${location.origin}${location.pathname}#/portal/${token}`;
        await navigator.clipboard.writeText(url);
        loadRows();
        toast.success("Public PO link copied");
        return;
      }
      const doc = await pos.get(r.id);
      // WhatsApp/SMS need a phone: look the supplier up by id, then by name.
      let phone = "";
      let email = doc.supplier_email || "";
      try {
        const supps = await suppliersApi.list();
        const sup =
          supps.find((s) => s.id === (doc.supplier_id ?? r.supplier_id)) ??
          supps.find((s) => s.name === r.supplier_name);
        phone = sup?.phone || doc.supplier_phone || "";
        email = email || sup?.email || "";
      } catch {
        /* contact details are optional */
      }
      const ccy = doc.currency || r.currency || statCcy;
      const eta = r.expected_date ? ` ETA ${fmtDate(r.expected_date)}.` : "";
      const text = `Purchase Order ${doc.po_number} to ${
        doc.supplier_name || r.supplier_name
      } — ${doc.items.length} item(s), ${money(r.total, ccy)}.${eta}`;
      if (kind === "email") {
        await sendShareEmail(email, `Purchase Order ${doc.po_number}`, text);
        toast.success(`Purchase order emailed to ${email}`);
        return;
      }
      shareVia(kind, {
        phone,
        email,
        text,
        // shareVia uses `url` as the mail subject for email shares.
        url: `Purchase Order ${doc.po_number}`,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Manage POs end-to-end"
        action={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={newPo}>
              <Plus size={16} /> New PO
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm font-semibold text-danger">
            <span>{error}</span>
          </div>
        </div>
      )}

      <DocPresetBar docType="po" company={company} onCompanySaved={setCompany} />

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Purchase Orders"
          value={num(rows.length)}
          icon={<ClipboardList size={20} />}
        />
        <MetricCard
          label="Total Value"
          value={aed(totalValue)}
          icon={<Wallet size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="Sent"
          value={num(sentCount)}
          icon={<Send size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Received"
          value={num(receivedCount)}
          icon={<PackageCheck size={20} />}
          iconClass="bg-success/15 text-success"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search POs by number or supplier…"
          className="max-w-xs flex-1 min-w-[220px]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            count={rows.length}
          >
            All
          </FilterChip>
          <FilterChip
            active={statusFilter === "draft"}
            onClick={() => setStatusFilter("draft")}
            count={rows.filter((r) => r.status === "draft").length}
          >
            Draft
          </FilterChip>
          <FilterChip
            active={statusFilter === "sent"}
            onClick={() => setStatusFilter("sent")}
            count={rows.filter((r) => r.status === "sent").length}
          >
            Sent
          </FilterChip>
          <FilterChip
            active={statusFilter === "received"}
            onClick={() => setStatusFilter("received")}
            tone="success"
            count={rows.filter((r) => r.status === "received").length}
          >
            Received
          </FilterChip>
          <FilterChip
            active={statusFilter === "cancelled"}
            onClick={() => setStatusFilter("cancelled")}
            tone="danger"
            count={rows.filter((r) => r.status === "cancelled").length}
          >
            Cancelled
          </FilterChip>
        </div>
      </div>

      <DataTable<PoSummary>
        pageSize={10}
        rows={filtered}
        loading={loading}
        empty={
          search || statusFilter !== "all"
            ? "No purchase orders match your filters"
            : "No purchase orders yet — create your first one"
        }
        rowKey={(r) => r.id}
        bulkActions={[
          {
            label: "Share",
            run: async (sel) => {
              for (const r of sel) await pos.shareDoc(r.id, true);
              loadRows();
              toast.success(`Shared ${sel.length}.`);
            },
          },
          {
            label: "Mark sent",
            run: async (sel) => {
              for (const r of sel) await pos.setStatus(r.id, "sent");
              loadRows();
              toast.success(`Updated ${sel.length}.`);
            },
          },
          {
            label: "Copy public link",
            run: async (sel) => {
              try {
                const token = await pos.publicLink(sel[0].id);
                const url = `${location.origin}${location.pathname}#/portal/${token}`;
                await navigator.clipboard.writeText(url);
                loadRows();
                toast.success("Public PO link copied");
              } catch (e) {
                toast.error(errMsg(e));
              }
            },
          },
          {
            label: "Delete",
            danger: true,
            run: async (sel) => {
              const ok = await confirm({
                title: "Delete purchase orders",
                message: `Delete ${sel.length} purchase order(s)?`,
                danger: true,
              });
              if (!ok) return;
              for (const r of sel) await pos.remove(r.id);
              loadRows();
              toast.success(`Deleted ${sel.length}.`);
            },
          },
        ]}
        columns={[
          {
            key: "no",
            label: "PO #",
            sortValue: (r) => r.po_number,
            render: (r) => (
              <span className="font-mono text-xs font-medium text-primary-700 dark:text-primary-300">
                {r.po_number}
              </span>
            ),
          },
          {
            key: "sup",
            label: "Supplier",
            sortValue: (r) => r.supplier_name,
            render: (r) => <span className="font-medium">{r.supplier_name}</span>,
          },
          {
            key: "total",
            label: "Total",
            sortValue: (r) => r.total,
            // A PO raised in USD is a USD figure — label it as its own.
            render: (r) => (
              <span className="font-medium">{money(r.total, r.currency || statCcy)}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (r) => r.status,
            render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
          },
          {
            key: "expected",
            label: "ETA",
            sortValue: (r) => r.expected_date ?? "",
            render: (r) => (r.expected_date ? fmtDate(r.expected_date) : "—"),
          },
          {
            key: "share",
            label: "Sharing",
            render: (r) => (
              <ShareToggle
                shared={r.shared}
                onToggle={async (next) => {
                  try {
                    await pos.shareDoc(r.id, next);
                    loadRows();
                    toast.success(next ? "Shared with team." : "Set to private.");
                  } catch (e) {
                    toast.error(errMsg(e));
                  }
                }}
              />
            ),
          },
          {
            key: "act",
            label: "Actions",
            render: (r) => (
              <div className="flex items-center justify-end gap-1">
                <button
                  aria-label="Record payment"
                  title="Record payment"
                  className="text-brand-500 hover:text-primary-700 hover:bg-brand-50 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => setPayFor(r)}
                >
                  <CreditCard size={15} />
                </button>
                {r.status !== "received" && (
                  <button
                    aria-label="Receive stock"
                    title="Receive into inventory"
                    className="text-success hover:bg-success/10 rounded-lg p-1.5 cursor-pointer transition-colors duration-200"
                    onClick={() => receiveRow(r, confirm, toast, loadRows)}
                  >
                    <PackageCheck size={15} />
                  </button>
                )}
                <RowActions
                  onView={() => openQuickView(r)}
                  onEdit={() => editPo(r.id, setForm, company, toast)}
                  onCopy={() =>
                    duplicatePo(
                      r.id,
                      setForm,
                      company,
                      rows.map((x) => x.po_number),
                      toast,
                      docFmts
                    )
                  }
                  onSend={{
                    whatsapp: () => sendPo("whatsapp", r),
                    email: () => sendPo("email", r),
                    sms: () => sendPo("sms", r),
                    copyLink: () => sendPo("copyLink", r),
                  }}
                  onDelete={() => deleteRow(r, confirm, toast, loadRows)}
                />
              </div>
            ),
          },
        ]}
      />

      {company && (
        <CompanyModal
          open={companyOpen}
          company={company}
          onClose={() => setCompanyOpen(false)}
          onSaved={(c) => setCompany(c)}
        />
      )}

      {payFor && <PoPaymentsModal po={payFor} onClose={() => setPayFor(null)} onSaved={loadRows} />}

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        onEdit={
          quickView
            ? () => {
                const id = quickView.id;
                setQuickView(null);
                editPo(id, setForm, company, toast);
              }
            : undefined
        }
        data={quickView?.data ?? null}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  List actions                                                       */
/* ------------------------------------------------------------------ */

async function receiveRow(
  r: PoSummary,
  confirm: ReturnType<typeof useUI>["confirm"],
  toast: ReturnType<typeof useUI>["toast"],
  refresh: () => void
) {
  const ok = await confirm({
    title: "Receive stock",
    message: `Receive all items on ${r.po_number} into inventory? This increases product stock.`,
  });
  if (!ok) return;
  try {
    await pos.receive(r.id);
    refresh();
    toast.success("Stock received.");
  } catch (e) {
    toast.error(errMsg(e));
  }
}

async function deleteRow(
  r: PoSummary,
  confirm: ReturnType<typeof useUI>["confirm"],
  toast: ReturnType<typeof useUI>["toast"],
  refresh: () => void
) {
  const ok = await confirm({
    title: "Delete purchase order",
    message: `Delete ${r.po_number}?`,
    danger: true,
  });
  if (!ok) return;
  try {
    await pos.remove(r.id);
    refresh();
    toast.success(`Deleted ${r.po_number}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

function poDocToForm(
  po: PurchaseOrder,
  supplier: Supplier | undefined,
  company: CompanyProfile | null
): Form {
  return {
    id: po.id,
    po_number: po.po_number,
    status: po.status,
    doc_title: po.doc_title || "Purchase Order",
    template: po.template || company?.default_template || "minimal",
    accent: po.accent || company?.default_accent || "#222222",
    currency: po.currency || company?.currency || "AED",
    seller_name: po.seller_name || company?.name || "",
    seller_address: po.seller_address || company?.address,
    seller_trn: po.seller_trn || company?.trn,
    seller_email: po.seller_email || company?.email,
    seller_phone: po.seller_phone || company?.phone,
    logo: po.logo || company?.logo,
    supplier_id: po.supplier_id,
    supplier_name: supplier?.name || po.supplier_name || "",
    supplier_address: supplier?.address || po.supplier_address || "",
    supplier_trn: supplier?.tax_id || po.supplier_trn || "",
    supplier_email: supplier?.email || po.supplier_email || "",
    supplier_phone: supplier?.phone || po.supplier_phone || "",
    order_date: po.order_date || today(),
    expected_date: po.expected_date,
    notes: po.notes,
    terms: po.terms,
    tax_rate: po.tax_rate ?? 0,
    discount: po.discount ?? 0,
    total: po.total,
    stamp: normStamp((po as any).stamp as Partial<StampSig> | undefined, EMPTY_STAMP_SIG.stamp),
    signature: normStamp(
      (po as any).signature as Partial<StampSig> | undefined,
      EMPTY_STAMP_SIG.signature
    ),
    show_stamp: po.show_stamp ?? false,
    show_signature: po.show_signature ?? false,
    show_bank: (po as any).show_bank ?? false,
    unit_price_formula: po.unit_price_formula || null,
    items: po.items.map((i) => {
      const { custom, pageBreakBefore } = splitPageBreak(i.custom);
      return {
        product_id: i.product_id,
        description: i.description,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        unit: i.unit || "",
        custom,
        pageBreakBefore,
      };
    }),
    customColumns: sanitizeCustomColumns(po.custom_columns || []),
    shared: po.shared,
    share_token: po.share_token,
  };
}

async function editPo(
  id: number,
  setForm: (f: Form) => void,
  company: CompanyProfile | null,
  toast: ReturnType<typeof useUI>["toast"]
) {
  try {
    const po = await pos.get(id);
    const supps = await suppliersApi.list();
    setForm(
      poDocToForm(po, supps.find((s) => s.id === po.supplier_id), company)
    );
  } catch (e: any) {
    toast.error(e?.message || "Failed to load purchase order");
  }
}

// DEMO parity: duplicate from the list — loads the real PO and opens it in the
// editor as an unsaved draft with a fresh PO number (persisted via pos.save).
async function duplicatePo(
  id: number,
  setForm: (f: Form) => void,
  company: CompanyProfile | null,
  existing: string[],
  toast: ReturnType<typeof useUI>["toast"],
  formats?: DocFormats
) {
  try {
    const po = await pos.get(id);
    const supps = await suppliersApi.list();
    const f = poDocToForm(po, supps.find((s) => s.id === po.supplier_id), company);
    setForm({
      ...f,
      id: undefined,
      status: "draft",
      po_number: pickDocNumber("purchase_order", existing, formats),
      order_date: today(),
      shared: false,
      share_token: undefined,
    });
    toast.success("Duplicated into a new draft PO.");
  } catch (e: any) {
    toast.error(e?.message || "Failed to duplicate purchase order");
  }
}

/* ------------------------------------------------------------------ */
/*  Editor                                                             */
/* ------------------------------------------------------------------ */

function Editor({
  form,
  setForm,
  rows,
  company,
  onBack,
  onSaved,
  onEditCompany,
  tplRev,
  onTplRev,
  docFmts,
}: {
  form: Form;
  setForm: (f: Form) => void;
  rows: PoSummary[];
  company: CompanyProfile | null;
  onBack: () => void;
  onSaved: () => void;
  onEditCompany: () => void;
  tplRev: number;
  onTplRev: () => void;
  /** Saved number formats, so a duplicate numbers itself the user's way. */
  docFmts: DocFormats;
}) {
  const { toast, confirm } = useUI();
  const poRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [designing, setDesigning] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [viewOpen, setViewOpen] = useState(false);
  const [viewPage, setViewPage] = useState(1);
  const [companyStampSig, setCompanyStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [bank, setBank] = useState<BankInfo>(EMPTY_BANK);
  const [bankX, setBankX] = useState(50);
  const [bankY, setBankY] = useState(88);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierModal, setSupplierModal] = useState(false);
  const [invOpen, setInvOpen] = useState(false);

  useEffect(() => {
    loadCompanyStampSig()
      .then(setCompanyStampSig)
      .catch(() => {});
    loadBankInfo().then(setBank).catch(() => {});
  }, []);

  useEffect(() => {
    suppliersApi
      .list()
      .then(setSuppliers)
      .catch(() => toast.error("Failed to load suppliers"));
  }, []);

  const docItems = useMemo(() => form.items.map(toDocItem), [form.items]);
  const pages = useMemo(() => paginateItems(docItems), [docItems]);
  const totals = useMemo(
    () => docTotals(docItems, 0, 0, form.unit_price_formula),
    [docItems, form.unit_price_formula]
  );

  useEffect(() => {
    setPreviewPage(1);
  }, [form.items.length]);

  const previewPages = pages.length;
  const curPageIdx = Math.min(previewPage, previewPages) - 1;
  const pageStartIndex = pages
    .slice(0, curPageIdx)
    .reduce((n, g) => n + g.length, 0);
  const isLastPreviewPage = curPageIdx === previewPages - 1;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  const applySupplier = (s: Supplier) =>
    setForm({
      ...form,
      supplier_id: s.id,
      supplier_name: s.name,
      supplier_address: s.address ?? "",
      supplier_email: s.email ?? "",
      supplier_phone: s.phone ?? "",
      supplier_trn: s.tax_id ?? form.supplier_trn,
    });

  const setItem = (idx: number, patch: Partial<Item>) => {
    const items = form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setForm({ ...form, items });
  };

  const addItem = () =>
    setForm({
      ...form,
      items: [
        ...form.items,
        { description: "", quantity: 1, unit_cost: 0, unit: "", custom: {}, pageBreakBefore: false },
      ],
    });

  const removeItem = (idx: number) =>
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const setItemCustom = (idx: number, key: string, value: string) => {
    if (key === "__pagebreak") return;
    const items = form.items.map((it, i) =>
      i === idx ? { ...it, custom: { ...it.custom, [key]: value } } : it
    );
    setForm({ ...form, items });
  };

  const addCustomColumn = () => {
    const label = window.prompt("Column name:")?.trim();
    if (!label) return;
    const key =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") || `col_${Date.now()}`;
    if (key === "__pagebreak") {
      toast.error("That name is reserved");
      return;
    }
    if (RESERVED_ITEM_COLUMNS.has(key)) {
      toast.error(`"${label}" is a default column and cannot be added again`);
      return;
    }
    if (form.customColumns.some((c) => c.key === key)) {
      toast.error("A column with that key already exists");
      return;
    }
    if (form.customColumns.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      toast.error("A column with that name already exists");
      return;
    }
    setForm({ ...form, customColumns: [...form.customColumns, { key, label }] });
  };

  const removeCustomColumn = (key: string) => {
    setForm({
      ...form,
      customColumns: form.customColumns.filter((c) => c.key !== key),
      items: form.items.map((it) => {
        const c = { ...it.custom };
        delete c[key];
        return { ...it, custom: c };
      }),
    });
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const addItemFromProduct = (p: Product) => {
    const desc = [p.name, p.description?.trim()].filter(Boolean).join(" — ");
    setForm({
      ...form,
      items: [
        ...form.items.filter((it) => it.description.trim() || it.unit_cost),
        {
          description: desc,
          quantity: 1,
          unit_cost: p.cost_price || p.unit_price,
          unit: p.unit || "",
          custom: {},
          product_id: p.id,
        },
      ],
    });
  };

  const duplicate = () => {
    if (!company) return;
    const next: Form = {
      ...form,
      id: undefined,
      status: "draft",
      po_number: pickDocNumber(
        "purchase_order",
        rows.map((r) => r.po_number),
        docFmts
      ),
      shared: false,
      share_token: undefined,
    };
    setForm(next);
    toast.success("Duplicated into a new draft PO.");
  };

  const handleSave = async () => {
    if (!form.supplier_name?.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    if (!form.items.length || form.items.every((i) => !i.description.trim())) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    try {
      const payload: PoInput = {
        ...form,
        total: totals.total,
        custom_columns: sanitizeCustomColumns(form.customColumns),
        items: form.items
          .filter((i) => i.description.trim())
          .map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unit_cost: it.unit_cost,
            unit: it.unit || undefined,
            custom: mergePageBreak(toDocItem(it)),
            product_id: it.product_id,
          })),
        order_date: form.order_date,
        expected_date: form.expected_date || undefined,
        show_stamp: form.show_stamp ?? false,
        show_signature: form.show_signature ?? false,
      } as PoInput;
      (payload as any).show_bank = form.show_bank ?? false;
      // Remove the in-memory aliases that don't exist on the DB model.
      delete (payload as any).customColumns;

      // TODO: pos.save recomputes total from qty*unit_cost, so formula-driven
      // line amounts are not reflected in the persisted total. Update the
      // API helper to accept/respect the total field when a formula is set.
      const id = await pos.save(payload);
      setForm({ ...form, id });
      await onSaved();

      // Auto-archive a PDF copy to My Files (deduped, best-effort).
      const el = exportRef.current || poRef.current;
      if (el) {
        try {
          const base = form.po_number || "po";
          const saved = await autoSaveDocument(`${base}.pdf`, "po", () =>
            elementToPdfBytes(el, base)
          );
          if (saved) toast.success("Saved a copy to My Files.");
        } catch {
          /* archiving is a convenience — never block save */
        }
      }
    } catch (e) {
      toast.error(`Could not save: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: string) => {
    if (!form.id) {
      toast.error("Save the PO first");
      return;
    }
    setSaving(true);
    try {
      await pos.setStatus(form.id, status);
      setForm({ ...form, status });
      await onSaved();
      toast.success(`PO marked ${status}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async () => {
    if (!form.id) {
      toast.error("Save the PO before receiving stock");
      return;
    }
    const ok = await confirm({
      title: "Receive stock",
      message: `Receive all items on ${form.po_number} into inventory?`,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await pos.receive(form.id);
      setForm({ ...form, status: "received" });
      await onSaved();
      toast.success("Stock received.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const copyPublicLink = async () => {
    if (!form.id) {
      toast.error("Save the PO before sharing a public link");
      return;
    }
    try {
      const token = await pos.publicLink(form.id);
      const url = `${location.origin}${location.pathname}#/portal/${token}`;
      await navigator.clipboard.writeText(url);
      setForm({ ...form, shared: true });
      await onSaved();
      toast.success("Public link copied");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const downloadPdf = () => {
    const el = exportRef.current || poRef.current;
    if (el) downloadElementAsPdf(el, form.po_number || "po");
    else window.print();
  };

  // Keyboard shortcuts
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
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        downloadPdf();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const docViewForm = useMemo(
    () => ({
      template: form.template,
      accent: form.accent,
      currency: form.currency,
      doc_title: form.doc_title,
      number: form.po_number,
      logo: form.logo,
      seller_name: form.seller_name,
      seller_address: form.seller_address,
      seller_trn: form.seller_trn,
      seller_email: form.seller_email,
      seller_phone: form.seller_phone,
      customer_name: form.supplier_name,
      customer_address: form.supplier_address,
      customer_trn: form.supplier_trn,
      issue_date: form.order_date,
      due_date: form.expected_date,
      tax_rate: form.tax_rate ?? 0,
      discount: form.discount ?? 0,
      notes: form.notes,
      terms: form.terms,
      items: form.items.map((it) => ({
        description: it.description,
        qty: it.quantity,
        unit_price: it.unit_cost,
        unit: it.unit,
        custom: it.custom,
      })),
      customColumns: form.customColumns,
      unit_price_formula: form.unit_price_formula,
    }),
    [form]
  );

  const docViewLabels = {
    docTitle: form.doc_title || "Purchase Order",
    partyLabel: "Supplier",
    issuedLabel: "Order Date",
    dueLabel: "Expected",
    totalLabel: "Total",
  };

  const viewPages = paginateItems(docItems);
  const viewPageCount = viewPages.length;
  const viewPageIdx = Math.min(viewPage, viewPageCount) - 1;
  const viewPageStart = viewPages
    .slice(0, viewPageIdx)
    .reduce((n, g) => n + g.length, 0);
  const isLastViewPage = viewPageIdx === viewPageCount - 1;

  useEffect(() => {
    if (viewOpen) setViewPage(1);
  }, [viewOpen]);

  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  const activeStamp = form.show_stamp
    ? form.stamp?.data
      ? form.stamp
      : companyStampSig.stamp
    : undefined;
  const activeSignature = form.show_signature
    ? form.signature?.data
      ? form.signature
      : companyStampSig.signature
    : undefined;

  const onStampMove = (x: number, y: number) => {
    const base = form.stamp?.data ? form.stamp : companyStampSig.stamp;
    if (base) setForm({ ...form, stamp: { ...base, x, y } });
  };
  const onSignatureMove = (x: number, y: number) => {
    const base = form.signature?.data ? form.signature : companyStampSig.signature;
    if (base) setForm({ ...form, signature: { ...base, x, y } });
  };

  return (
    <div>
      {/* Header bar */}
      <div className="no-print flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            className="rounded-xl p-2.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer mt-0.5"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Create Purchase Order</h1>
            <p className="text-sm text-brand-500 mt-0.5">
              Create and share purchase orders with your suppliers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={statusTone(form.status)}>{form.status}</Badge>
          {!form.id && <span className="text-xs font-medium text-brand-400">Unsaved</span>}

          <button className="btn-ghost" onClick={() => setViewOpen(true)}>
            <Plus size={15} /> View
          </button>
          <button className="btn-ghost" onClick={downloadPdf} title="Download PDF (Ctrl+P)">
            <Download size={15} /> PDF
          </button>
          <button className="btn-ghost" onClick={duplicate}>
            <Copy size={15} /> Duplicate
          </button>
          <button className="btn-ghost" onClick={handleSave} disabled={saving}>
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>

          {form.status === "draft" && (
            <button className="btn-primary" onClick={() => setStatus("sent")} disabled={saving}>
              <Send size={15} /> Mark Sent
            </button>
          )}
          {form.status === "sent" && (
            <>
              <button className="btn-primary" onClick={handleReceive} disabled={saving}>
                <Truck size={15} /> Mark Received
              </button>
              <button className="btn-ghost" onClick={() => setStatus("cancelled")} disabled={saving}>
                <X size={15} /> Cancel
              </button>
            </>
          )}
          {(form.status === "received" || form.status === "cancelled") && (
            <button className="btn-ghost" onClick={() => setStatus("draft")} disabled={saving}>
              <Pencil size={15} /> Move to draft
            </button>
          )}

          {form.id && (
            <button className="btn-ghost" onClick={copyPublicLink}>
              <Copy size={15} /> Public link
            </button>
          )}

          {form.id && (
            <ShareToggle
              shared={form.shared}
              onToggle={async (next) => {
                try {
                  await pos.shareDoc(form.id!, next);
                  setForm({ ...form, shared: next });
                  onSaved();
                  toast.success(next ? "Shared with team." : "Set to private.");
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            />
          )}
        </div>
      </div>

      <SupplierQuickAdd
        open={supplierModal}
        onClose={() => setSupplierModal(false)}
        onSaved={(s) => {
          applySupplier(s);
          setSupplierModal(false);
          suppliersApi.list().then(setSuppliers).catch(() => {});
        }}
      />

      <InventoryImportModal
        open={invOpen}
        onClose={() => setInvOpen(false)}
        onPick={(p) => {
          addItemFromProduct(p);
          toast.success(`Added ${p.name}`);
        }}
      />

      <ResizablePanels
        left={
          <div className="no-print space-y-4">
            {/* 1 · Template */}
            <Step n={1} title="Choose Template">
              <DocTemplateGallery
                              key={tplRev}
                              value={form.template}
                              onChange={(id) => set("template", id)}
                              onDesign={() => setDesigning(true)}
                              docType="po"
                            />
              <div className="flex items-center justify-between mt-3 border border-brand-200 rounded-xl px-3 py-2">
                <span className="text-xs font-semibold text-brand-500">Accent color</span>
                <ColorPicker value={form.accent} onChange={(hex) => set("accent", hex)} />
              </div>
            </Step>

            {/* 2 · PO Details */}
            <Step n={2} title="Purchase Order Details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Field label="Supplier">
                    <div className="flex gap-2">
                      <select
                        className="select"
                        value={form.supplier_id ? String(form.supplier_id) : ""}
                        onChange={(e) => {
                          const s = suppliers.find((x) => String(x.id) === e.target.value);
                          if (s) applySupplier(s);
                        }}
                      >
                        <option value="">
                          {suppliers.length ? "Select saved supplier…" : "No saved suppliers yet"}
                        </option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-ghost shrink-0"
                        onClick={() => setSupplierModal(true)}
                        title="Add supplier"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </Field>
                  <Field label="Supplier Name">
                    <input
                      className="input"
                      placeholder="Acme Supplies LLC"
                      value={form.supplier_name}
                      onChange={(e) => set("supplier_name", e.target.value)}
                    />
                  </Field>
                  <Field label="Supplier Address">
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="Street, City, Country"
                      value={form.supplier_address ?? ""}
                      onChange={(e) => set("supplier_address", e.target.value)}
                    />
                  </Field>
                  <Field label="Supplier Email / TRN">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="input"
                        placeholder="Email"
                        value={form.supplier_email ?? ""}
                        onChange={(e) => set("supplier_email", e.target.value)}
                      />
                      <input
                        className="input"
                        placeholder="TRN"
                        value={form.supplier_trn ?? ""}
                        onChange={(e) => set("supplier_trn", e.target.value)}
                      />
                    </div>
                  </Field>
                </div>
                <div className="space-y-3">
                  <Field label="Document Title">
                    <input
                      className="input"
                      placeholder="Purchase Order"
                      value={form.doc_title || ""}
                      onChange={(e) => set("doc_title", e.target.value)}
                    />
                  </Field>
                  <Field label="PO Number">
                    <input
                      className="input"
                      value={form.po_number}
                      onChange={(e) => set("po_number", e.target.value)}
                    />
                  </Field>
                  <Field label="Order Date">
                    <DateField
                      value={form.order_date ?? ""}
                      onChange={(v) => set("order_date", v)}
                      clearable={false}
                    />
                  </Field>
                  <Field label="Expected Date (optional)">
                    <DateField
                      value={form.expected_date ?? ""}
                      onChange={(v) => set("expected_date", v)}
                    />
                  </Field>
                  <Field label="Currency">
                    <select
                      className="select"
                      value={form.currency || "AED"}
                      onChange={(e) => set("currency", e.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button className="btn-ghost w-full" onClick={onEditCompany}>
                    <Building2 size={15} /> Apply company defaults
                  </button>
                </div>
              </div>
            </Step>

            {/* 3 · Items */}
            <Step n={3} title="Items">
              <div className="rounded-xl border border-brand-200 p-3 mb-3">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-500 mb-2">
                  Multiply field with unit cost
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "unit_price_formula",
                        form.unit_price_formula ? null : { a: "", b: "unit_price" }
                      )
                    }
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      form.unit_price_formula ? "bg-primary-400" : "bg-brand-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        form.unit_price_formula ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                {form.unit_price_formula && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="input text-xs py-1.5 h-8"
                      value={form.unit_price_formula.a || ""}
                      onChange={(e) =>
                        set("unit_price_formula", { a: e.target.value, b: "unit_price" })
                      }
                    >
                      <option value="">Select field</option>
                      <option value="qty">Qty</option>
                      {form.customColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-brand-400">× unit cost</span>
                    <span className="text-[10px] text-brand-400">→ Amount</span>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-brand-500">
                      <th className="py-2 pr-2 w-6">#</th>
                      <th className="py-2 px-2">Description</th>
                      <th className="py-2 px-2 w-24 text-right">Qty</th>
                      <th className="py-2 px-2 w-24 text-right">Unit</th>
                      {form.customColumns.map((col, idx) => (
                        <th
                          key={col.key}
                          className="py-2 px-2 text-right group relative cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", col.key);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromKey = e.dataTransfer.getData("text/plain");
                            if (fromKey && fromKey !== col.key) {
                              const fromIdx = form.customColumns.findIndex((c) => c.key === fromKey);
                              const toIdx = idx;
                              if (fromIdx >= 0) {
                                const next = [...form.customColumns];
                                const [moved] = next.splice(fromIdx, 1);
                                next.splice(toIdx, 0, moved);
                                setForm({ ...form, customColumns: next });
                              }
                            }
                          }}
                        >
                          <span className="text-[10px]">{col.label}</span>
                          <button
                            className="ml-1 opacity-0 group-hover:opacity-100 text-brand-400 hover:text-danger inline cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomColumn(col.key);
                            }}
                            title="Remove column"
                          >
                            ×
                          </button>
                        </th>
                      ))}
                      <th className="py-2 px-2 w-32 text-right">Unit Cost</th>
                      {(form.tax_rate || 0) > 0 && (
                        <th className="py-2 px-2 w-24 text-right">VAT</th>
                      )}
                      <th className="py-2 px-2 w-28 text-right">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i} className="border-t border-brand-100">
                        <td className="py-2 pr-2 text-brand-500">
                          {i + 1}
                          {it.pageBreakBefore && i > 0 && (
                            <span className="ml-1 text-[10px] text-primary-700 font-medium">↳ new page</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <input
                            className="input"
                            placeholder="Item description"
                            value={it.description}
                            onChange={(e) => setItem(i, { description: e.target.value })}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            className="input text-right !px-2"
                            value={it.quantity || ""}
                            placeholder="0"
                            onChange={(e) => setItem(i, { quantity: numInput(e.target.value) })}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            className="input text-right !px-2"
                            placeholder="pcs"
                            value={it.unit || ""}
                            list="unit-suggestions"
                            onChange={(e) => setItem(i, { unit: e.target.value })}
                          />
                        </td>
                        {form.customColumns.map((col) => (
                          <td key={col.key} className="py-2 px-2">
                            <input
                              className="input text-right !px-2 !py-1 text-xs"
                              placeholder={col.label}
                              value={it.custom?.[col.key] || ""}
                              onChange={(e) => setItemCustom(i, col.key, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            className={`input text-right !px-2 ${
                              form.unit_price_formula?.a ? "bg-brand-50/50" : ""
                            }`}
                            placeholder="0"
                            value={it.unit_cost || ""}
                            onChange={(e) => setItem(i, { unit_cost: numInput(e.target.value) })}
                          />
                        </td>
                        {(form.tax_rate || 0) > 0 && (
                          <td className="py-2 px-2 text-right text-brand-500">
                            {money(
                              (docLineAmount(toDocItem(it), form.unit_price_formula) *
                                (form.tax_rate || 0)) /
                                100,
                              form.currency || "AED"
                            )}
                            <span className="block text-[10px] text-brand-400">
                              {form.tax_rate}%
                            </span>
                          </td>
                        )}
                        <td className="py-2 px-2 text-right font-medium text-ink">
                          {money(docLineAmount(toDocItem(it), form.unit_price_formula), form.currency || "AED")}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              aria-label={
                                it.pageBreakBefore
                                  ? "Remove page break before this item"
                                  : "Start a new page at this item"
                              }
                              title={
                                i === 0
                                  ? "First item always starts page 1"
                                  : it.pageBreakBefore
                                    ? "Starts a new page here (click to remove)"
                                    : "Insert page break before this item"
                              }
                              disabled={i === 0}
                              className={`rounded-lg p-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                it.pageBreakBefore
                                  ? "text-primary-700 bg-primary-100"
                                  : "text-brand-400 hover:text-ink hover:bg-brand-50 cursor-pointer"
                              }`}
                              onClick={() => setItem(i, { pageBreakBefore: !it.pageBreakBefore })}
                            >
                              <SeparatorHorizontal size={14} />
                            </button>
                            <button
                              aria-label="Remove line"
                              className="text-brand-500 hover:text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer transition-colors"
                              onClick={() => removeItem(i)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {form.customColumns.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-brand-500">
                  <span className="mr-1">Custom fields (drag to reorder):</span>
                  {form.customColumns.map((col, idx) => (
                    <span
                      key={col.key}
                      className="inline-flex items-center gap-0.5 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-brand-100"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", col.key);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromKey = e.dataTransfer.getData("text/plain");
                        if (fromKey && fromKey !== col.key) {
                          const fromIdx = form.customColumns.findIndex((c) => c.key === fromKey);
                          const toIdx = idx;
                          if (fromIdx >= 0) {
                            const next = [...form.customColumns];
                            const [moved] = next.splice(fromIdx, 1);
                            next.splice(toIdx, 0, moved);
                            setForm({ ...form, customColumns: next });
                          }
                        }
                      }}
                    >
                      <span className="font-medium text-xs text-ink">{col.label}</span>
                      <button
                        className="text-brand-400 hover:text-danger ml-0.5 cursor-pointer transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustomColumn(col.key);
                        }}
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                <button className="btn-primary" onClick={addItem}>
                  <Plus size={14} /> Add Item
                </button>
                <button className="btn-ghost text-xs" onClick={() => setInvOpen(true)}>
                  <PackageCheck size={13} /> Import from Inventory
                </button>
                <button className="btn-ghost text-xs" onClick={addCustomColumn}>
                  <Plus size={12} /> Add Field
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const on = !form.show_stamp;
                    setForm({
                      ...form,
                      show_stamp: on,
                      stamp:
                        on && !form.stamp?.data && companyStampSig.stamp?.data
                          ? { ...companyStampSig.stamp }
                          : form.stamp,
                    });
                  }}
                  className={`btn-ghost text-xs ${form.show_stamp ? "!bg-brand-50 !text-ink" : ""}`}
                  disabled={!companyStampSig.stamp?.data}
                >
                  <Stamp size={13} /> Stamp: {form.show_stamp ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const on = !form.show_signature;
                    setForm({
                      ...form,
                      show_signature: on,
                      signature:
                        on && !form.signature?.data && companyStampSig.signature?.data
                          ? { ...companyStampSig.signature }
                          : form.signature,
                    });
                  }}
                  className={`btn-ghost text-xs ${form.show_signature ? "!bg-brand-50 !text-ink" : ""}`}
                  disabled={!companyStampSig.signature?.data}
                >
                  <PenTool size={13} /> Signature: {form.show_signature ? "On" : "Off"}
                </button>
              </div>

              {(form.show_stamp || form.show_signature) &&
                (companyStampSig.stamp?.data || companyStampSig.signature?.data) && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                    {form.show_stamp && (form.stamp?.data || companyStampSig.stamp?.data) && (
                      <StampSigAdjust
                        label="Stamp"
                        icon={<Stamp size={13} />}
                        value={form.stamp?.data ? form.stamp : companyStampSig.stamp!}
                        onChange={(v) => setForm({ ...form, stamp: v })}
                      />
                    )}
                    {form.show_signature &&
                      (form.signature?.data || companyStampSig.signature?.data) && (
                        <StampSigAdjust
                          label="Signature"
                          icon={<PenTool size={13} />}
                          value={
                            form.signature?.data ? form.signature : companyStampSig.signature!
                          }
                          onChange={(v) => setForm({ ...form, signature: v })}
                        />
                      )}
                  </div>
                )}

              <datalist id="unit-suggestions">
                <option value="pcs" />
                <option value="L" />
                <option value="mL" />
                <option value="kg" />
                <option value="g" />
                <option value="MT" />
                <option value="ton" />
                <option value="m" />
                <option value="cm" />
                <option value="ft" />
                <option value="sqm" />
                <option value="sqft" />
                <option value="hrs" />
                <option value="days" />
                <option value="set" />
                <option value="box" />
                <option value="carton" />
                <option value="drum" />
                <option value="barrel" />
                <option value="pack" />
                <option value="roll" />
                <option value="pair" />
                <option value="dozen" />
              </datalist>
            </Step>

            {/* 4 · Notes, terms & logo */}
            <Step n={4} title="Notes & Attachments">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-brand-500">Status</p>
                    <select
                      className="select"
                      value={form.status}
                      onChange={(e) => set("status", e.target.value)}
                    >
                      {["draft", "sent", "received", "cancelled"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field label="Notes">
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="Add notes for this purchase order"
                      value={form.notes ?? ""}
                      onChange={(e) => set("notes", e.target.value)}
                    />
                  </Field>
                  <Field label="Terms & Conditions">
                    <textarea
                      className="textarea"
                      rows={3}
                      placeholder="Payment terms, delivery terms, etc."
                      value={form.terms ?? ""}
                      onChange={(e) => set("terms", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-brand-500">Logo</p>
                  {form.logo ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={form.logo}
                        alt="logo"
                        className="h-12 w-12 object-contain border border-brand-200 rounded-xl bg-white"
                      />
                      <button className="btn-ghost text-xs" onClick={() => set("logo", null as any)}>
                        <X size={13} /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="btn-ghost w-full justify-center cursor-pointer">
                      <Upload size={14} /> Upload logo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onLogo(e.target.files?.[0])}
                      />
                    </label>
                  )}
                  <p className="text-[11px] text-brand-500">
                    Tip: set this once in Settings → Company Details to auto-fill every PO.
                  </p>
                  <div className="space-y-2 pt-2">
                    <Field label="VAT rate %">
                      <input
                        type="number"
                        className="input"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={form.tax_rate ?? ""}
                        onChange={(e) => set("tax_rate", numInput(e.target.value))}
                      />
                    </Field>
                    <ToggleTile
                      icon={Landmark}
                      label="Bank details"
                      desc={
                        hasBankInfo(bank)
                          ? "Show bank details on the PO"
                          : "Add bank details in Settings first"
                      }
                      active={!!form.show_bank}
                      onToggle={() => {
                        if (hasBankInfo(bank)) setForm({ ...form, show_bank: !form.show_bank });
                      }}
                    />
                  </div>
                </div>
              </div>
            </Step>
          </div>
        }
        right={
          <div className="sticky top-4 space-y-4">
            {designing && (
              <div className="mb-4">
                <TemplateDesigner
                  onSave={(t: CustomTemplate) => {
                    setDesigning(false);
                    onTplRev();
                    set("template", t.id);
                  }}
                  onClose={() => setDesigning(false)}
                />
              </div>
            )}

            <div className="card !p-4">
              <div className="no-print flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-ink flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-ink text-white grid place-items-center text-xs font-semibold">
                      2
                    </span>
                    Preview
                  </p>
                  <p className="text-xs text-brand-500 mt-0.5 ml-8">
                    This is how your PO will look
                  </p>
                </div>
              </div>

              <FitPreview baseWidth={device === "desktop" ? 794 : 420} zoom={zoom} padding={0}>
                {/* ponytail: keep PO preview + PDF English regardless of app lang */}
                <div ref={poRef} data-no-i18n dir="ltr">
                  <div
                    style={{
                      position: "relative",
                      minHeight: device === "desktop" ? 1027 : 498,
                    }}
                  >
                    <StampSignatureLayer
                      stamp={activeStamp}
                      signature={activeSignature}
                      onStampMove={onStampMove}
                      onSignatureMove={onSignatureMove}
                    />
                    <DocView
                      form={docViewForm as any}
                      pageItems={
                        docViewForm.items.slice(
                          pageStartIndex,
                          pageStartIndex + (pages[curPageIdx]?.length || 0)
                        ) as any
                      }
                      itemStartIndex={pageStartIndex}
                      showTotals={isLastPreviewPage}
                      showFooter={isLastPreviewPage}
                      labels={docViewLabels}
                    />
                    {form.show_bank && (
                      <DraggableBlock
                        x={bankX}
                        y={bankY}
                        onMove={(x, y) => { setBankX(x); setBankY(y); }}
                      >
                        <BankDetailsBlock bank={bank} accent={form.accent} />
                      </DraggableBlock>
                    )}
                  </div>
                </div>
              </FitPreview>

              {previewPages > 1 && (
                <div className="no-print flex items-center justify-center gap-2 mt-2">
                  <button
                    className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                    disabled={previewPage <= 1}
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  >
                    Back
                  </button>
                  <span className="text-xs text-brand-500 font-medium">
                    Page {previewPage} / {previewPages}
                  </span>
                  <button
                    className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                    disabled={previewPage >= previewPages}
                    onClick={() => setPreviewPage((p) => Math.min(previewPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}

              <div className="no-print flex items-center justify-between mt-3 gap-2 flex-wrap">
                <div className="flex items-center gap-1 rounded-xl bg-brand-50 p-1">
                  <button
                    className={`rounded-lg p-1.5 cursor-pointer transition-colors ${
                      device === "desktop"
                        ? "bg-primary-100 text-primary-700"
                        : "text-brand-500 hover:text-ink"
                    }`}
                    onClick={() => setDevice("desktop")}
                    aria-label="Desktop preview"
                  >
                    <Monitor size={15} />
                  </button>
                  <button
                    className={`rounded-lg p-1.5 cursor-pointer transition-colors ${
                      device === "mobile"
                        ? "bg-primary-100 text-primary-700"
                        : "text-brand-500 hover:text-ink"
                    }`}
                    onClick={() => setDevice("mobile")}
                    aria-label="Mobile preview"
                  >
                    <Smartphone size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50 transition-colors"
                    onClick={() => setZoom((z) => Math.max(50, z - 10))}
                    aria-label="Zoom out"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-xs font-semibold text-brand-500 w-10 text-center">
                    {zoom}%
                  </span>
                  <button
                    className="rounded-lg border border-brand-200 p-1.5 text-brand-500 cursor-pointer hover:bg-brand-50 transition-colors"
                    onClick={() => setZoom((z) => Math.min(150, z + 10))}
                    aria-label="Zoom in"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost text-xs" onClick={handleSave} disabled={saving}>
                    <Save size={14} /> Save
                  </button>
                  <button className="btn-primary text-xs" onClick={downloadPdf}>
                    <Download size={14} /> PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        }
      />

      {/* Off-screen export container — always mounted so PDF export works
          even when the preview panel is collapsed. */}
      {(() => {
        const exportPages = paginateItems(docItems);
        return (
          <div
            ref={exportRef}
            aria-hidden
            data-no-i18n
            dir="ltr"
            className="fixed left-[-99999px] top-0 pointer-events-none"
            style={{ width: 794, background: "#fff" }}
          >
            {exportPages.map((group, gi) => {
              const startIdx = exportPages
                .slice(0, gi)
                .reduce((n, g) => n + g.length, 0);
              const isLast = gi === exportPages.length - 1;
              return (
                <div
                  key={gi}
                  className="invoice-print"
                  style={{
                    width: 794,
                    height: 1123,
                    background: "#fff",
                    position: "relative",
                    overflow: "hidden",
                    padding: 48,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      minHeight: 1027,
                      background: "#fff",
                    }}
                  >
                    {isLast && (
                      <StampSignatureLayer
                        stamp={activeStamp}
                        signature={activeSignature}
                        onStampMove={() => {}}
                        onSignatureMove={() => {}}
                      />
                    )}
                    <DocView
                      form={docViewForm as any}
                      pageItems={
                        docViewForm.items.slice(
                          startIdx,
                          startIdx + group.length
                        ) as any
                      }
                      itemStartIndex={startIdx}
                      showTotals={isLast}
                      showFooter={isLast}
                      labels={docViewLabels}
                    />
                    {isLast && form.show_bank && (
                      <DraggableBlock x={bankX} y={bankY} onMove={() => {}}>
                        <BankDetailsBlock bank={bank} accent={form.accent} />
                      </DraggableBlock>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Full-screen view modal. Portaled out of <main>'s scrolling subtree —
          WebView2 half-paints a `fixed` overlay that stays inside it. */}
      {viewOpen && createPortal(
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
                  {form.po_number || "PO preview"}
                </h2>
                <span className="text-xs font-semibold text-brand-500 bg-brand-50 dark:bg-white/10 dark:text-brand-500 px-2.5 py-1 rounded-full">
                  Page {viewPage} of {viewPageCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {viewPageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-ghost h-8 px-2 text-xs disabled:opacity-40"
                      disabled={viewPage <= 1}
                      onClick={() => setViewPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <span className="text-xs text-brand-500 font-medium w-16 text-center">
                      {viewPage} / {viewPageCount}
                    </span>
                    <button
                      className="btn-ghost h-8 px-2 text-xs disabled:opacity-40"
                      disabled={viewPage >= viewPageCount}
                      onClick={() => setViewPage((p) => Math.min(viewPageCount, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                )}
                <button className="btn-ghost h-9 text-xs" onClick={downloadPdf}>
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
                <div className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:bg-white min-h-[1123px]" data-no-i18n dir="ltr">
                  <div style={{ position: "relative", minHeight: 1059 }}>
                    <StampSignatureLayer
                      stamp={activeStamp}
                      signature={activeSignature}
                      onStampMove={onStampMove}
                      onSignatureMove={onSignatureMove}
                    />
                    <DocView
                      form={docViewForm as any}
                      pageItems={
                        docViewForm.items.slice(
                          viewPageStart,
                          viewPageStart + (viewPages[viewPageIdx]?.length || 0)
                        ) as any
                      }
                      itemStartIndex={viewPageStart}
                      showTotals={isLastViewPage}
                      showFooter={isLastViewPage}
                      labels={docViewLabels}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="w-7 h-7 rounded-full bg-foreground text-background grid place-items-center text-[13px] font-semibold shrink-0">
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-tight">{title}</p>
          {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InventoryImportModal({
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
    if (open)
      erp
        .products()
        .then(setProducts)
        .catch(() => toast.error("Failed to load products"));
  }, [open]);
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Modal open={open} onClose={onClose} title="Add from Inventory">
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Search products or SKU…"
        className="mb-3"
      />
      <div className="max-h-72 overflow-y-auto space-y-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-brand-50 dark:hover:bg-white/5 cursor-pointer text-left transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink truncate">{p.name}</p>
              <p className="text-[11px] text-brand-500 font-medium">{p.sku}</p>
            </div>
            <span className="text-sm font-medium text-ink">{money(p.unit_price, "AED")}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-brand-500 text-center py-6">
            No products found. Add them in Inventory first.
          </p>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <button className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function SupplierQuickAdd({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const { toast } = useUI();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [trn, setTrn] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    setBusy(true);
    try {
      const id = await suppliersApi.create({
        name: name.trim(),
        address: address.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        tax_id: trn.trim() || undefined,
      });
      toast.success("Supplier added.");
      onSaved({
        id,
        name: name.trim(),
        address: address.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        tax_id: trn.trim() || undefined,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Quick Add Supplier" size="md">
      <div className="space-y-3">
        <Field label="Supplier Name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
        </Field>
        <Field label="Address">
          <textarea
            className="textarea"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Dubai, UAE"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="TRN">
          <input
            className="input"
            value={trn}
            onChange={(e) => setTrn(e.target.value)}
            placeholder="Tax Registration Number"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving…" : "Add Supplier"}
        </button>
      </div>
    </Modal>
  );
}


function PoPaymentsModal({
  po,
  onClose,
  onSaved,
}: {
  po: PoSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<PoPayment[]>([]);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("bank transfer");
  const [paidAt, setPaidAt] = useState(todayYmd());
  const [busy, setBusy] = useState(false);

  const load = () => {
    pos
      .payments(po.id)
      .then(setRows)
      .catch(() => setRows([]));
  };
  useEffect(load, [po.id]);

  const total = po.total;
  const paid = rows.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);

  const add = async () => {
    if (amount <= 0) return;
    setBusy(true);
    try {
      await pos.addPayment(po.id, amount, method || null, paidAt);
      setAmount(0);
      load();
      onSaved();
      toast.success("Payment recorded.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!(await confirm({ title: "Remove payment", message: "Remove this payment record?" }))) return;
    try {
      await pos.removePayment(id);
      load();
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const ccy = po.currency || "AED";
  return (
    <Modal open onClose={onClose} title={`Payments — ${po.po_number}`}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-brand-50 px-3 py-2.5">
          <p className="text-[10px] uppercase text-brand-400">Total</p>
          <p className="font-bold text-sm tabular-nums">{money(total, ccy)}</p>
        </div>
        <div className="rounded-xl bg-success/10 px-3 py-2.5">
          <p className="text-[10px] uppercase text-success/70">Paid</p>
          <p className="font-bold text-sm text-success tabular-nums">{money(paid, ccy)}</p>
        </div>
        <div className={`rounded-xl px-3 py-2.5 ${balance > 0 ? "bg-danger/10" : "bg-success/10"}`}>
          <p className="text-[10px] uppercase text-brand-400">Balance</p>
          <p className={`font-bold text-sm tabular-nums ${balance > 0 ? "text-danger" : "text-success"}`}>
            {money(balance, ccy)}
          </p>
        </div>
      </div>

      <div className="flex items-end gap-2 mb-4 p-3 bg-brand-50 rounded-xl">
        <div className="flex-1">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Amount</label>
          <input
            type="number"
            min={0}
            className="input tabular-nums"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="w-32">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Method</label>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>bank transfer</option>
            <option>cash</option>
            <option>cheque</option>
            <option>online</option>
          </select>
        </div>
        <div className="w-32">
          <label className="text-[10px] font-semibold text-brand-400 block mb-1">Date</label>
          <DateField value={paidAt} onChange={setPaidAt} clearable={false} />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || amount <= 0} onClick={add}>
          {busy ? "…" : "Add"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-sm text-brand-400 py-4">No payments recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold text-brand-400 border-b border-brand-100">
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-left">Method</th>
              <th className="py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-brand-50">
                <td className="py-2">{fmtDate(p.paid_at)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{money(p.amount, ccy)}</td>
                <td className="py-2 capitalize">{p.method || "—"}</td>
                <td className="py-2">
                  <button
                    aria-label="Remove payment"
                    className="text-danger hover:bg-danger/10 rounded p-1 cursor-pointer"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
