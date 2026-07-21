import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  User,
  Building2,
  BadgeCheck,
  Pencil,
  Plus,
  Save,
  X,
  FileText,
  Download,
  Printer,
  Copy,
  Send,
  FileDown,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  advances,
  billing,
  suppliers as suppliersApi,
  pos,
  type CompanyProfile,
  type Supplier,
  type PoSummary,
} from "../lib/api";
import { Badge, statusTone, Card, Skeleton, Modal, Field } from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
  type ShareKind,
} from "../components/RowActions";
import { aed, num, fmtDate, errMsg, cn, money, localYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import ActivityTimeline from "../components/ActivityTimeline";
import PartyBankDetails from "../components/PartyBankDetails";
import AdvanceCard from "../components/AdvanceCard";
import StatementModal, {
  type StatementDocRef,
} from "../components/statements/StatementModal";
import FitPreview from "../components/FitPreview";
import { downloadElementAsPdf } from "../lib/pdfTools";
import {
  buildStatement,
  type StatementAdvanceEntry,
  type StatementDocEntry,
  type StatementPaymentEntry,
} from "../components/statements/buildStatement";
import {
  paginateStatementLines,
  StatementThumb,
  statementTemplateList,
  statementTemplates,
  type StatementPage,
  type StatementTemplateKey,
} from "../components/statements/StatementTemplates";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-medium text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

/** DEMO parity: icon + label-over-value row for the Contact panel. */
function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        <div className="text-[13px] text-foreground truncate">{value}</div>
      </div>
    </div>
  );
}

/** DEMO parity: one cell of the joined KPI grid (12px label / 24px value /
 *  11.5px hint). Hairline dividers come via className on the wrapper. */
function KpiCell({
  label,
  value,
  hint,
  valueClass,
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-card p-5", className)}>
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-[24px] font-semibold tracking-tight tabular-nums",
          valueClass ?? "text-foreground"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { toast, confirm } = useUI();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PoSummary[]>([]);
  const [showAllPos, setShowAllPos] = useState(false);
  const [qv, setQv] = useState<QuickViewData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  // Inline statement panel (DEMO parity): template picker + live preview.
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [tplKey, setTplKey] = useState<StatementTemplateKey>("ledger");
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [stmtPayments, setStmtPayments] = useState<StatementPaymentEntry[]>([]);
  const [stmtAdvances, setStmtAdvances] = useState<StatementAdvanceEntry[]>([]);
  const [stmtExtrasLoading, setStmtExtrasLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      suppliersApi.list(),
      pos.list(),
      billing.getCompany().catch(() => null),
    ])
      .then(([ss, ps, co]) => {
        if (!alive) return;
        setList(ss);
        setOrders(ps);
        setCompany(co);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Refetch everything after a mutation (delete / share / edit). */
  const reload = () => {
    Promise.all([
      suppliersApi.list(),
      pos.list(),
      billing.getCompany().catch(() => null),
    ])
      .then(([ss, ps, co]) => {
        setList(ss);
        setOrders(ps);
        setCompany(co);
      })
      .catch(() => {});
  };

  const supplier = useMemo(() => list.find((s) => String(s.id) === id), [list, id]);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (supplier) setNotesDraft(supplier.notes || "");
  }, [supplier?.id]);

  const saveNotes = async () => {
    if (!supplier || !id) return;
    setSavingNotes(true);
    try {
      await suppliersApi.update(Number(id), { notes: notesDraft || undefined });
      // Update local state
      setList((prev) =>
        prev.map((s) => (s.id === Number(id) ? { ...s, notes: notesDraft } : s))
      );
      setEditingNotes(false);
      toast.success("Notes saved.");
    } catch (e) {
      toast.error("Failed to save notes.");
    } finally {
      setSavingNotes(false);
    }
  };

  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (supplier != null && o.supplier_id === supplier.id) ||
          (supplier != null && o.supplier_name === supplier.name)
      ),
    [orders, supplier]
  );

  // localdb is schemaless — older/agent-created rows may lack status.
  const st = (o: { status?: string }) => (o.status || "").toLowerCase();

  /** PO docs handed to the Statement of Account modal (it derives the
   *  ledger: POs as debits + dated payments/advances as credits). */
  const stmtDocs = useMemo<StatementDocRef[]>(
    () =>
      myOrders.map((o) => ({
        id: o.id,
        number: o.po_number,
        date: o.order_date,
        total: o.total,
        currency: o.currency,
        status: o.status,
        tax_rate: o.tax_rate,
      })),
    [myOrders]
  );
  const totalValue = myOrders.reduce((s, o) => s + o.total, 0);
  const openCount = myOrders.filter(
    (o) => !["received", "cancelled"].includes(st(o))
  ).length;
  const receivedValue = myOrders
    .filter((o) => st(o) === "received")
    .reduce((s, o) => s + o.total, 0);

  /** Live purchase orders only are statement debits (drafts and cancelled
   *  POs never hit the account) — the same rule the StatementModal applies. */
  const ledgerDocs = useMemo(
    () => myOrders.filter((o) => st(o) !== "draft" && st(o) !== "cancelled"),
    [myOrders]
  );
  const docKey = ledgerDocs.map((o) => o.id).join(",");

  /* Phase-2 statement data: dated PO payments + advance payments — the same
   *  fetches the StatementModal performs on open, keyed by the doc set. */
  useEffect(() => {
    if (!supplier) return;
    let alive = true;
    setStmtExtrasLoading(true);
    const perDoc: Promise<StatementPaymentEntry[]> = Promise.all(
      ledgerDocs.map((o) =>
        pos
          .payments(o.id)
          .then((ps) =>
            ps.map((p) => ({
              date: (p.paid_at || "").slice(0, 10),
              amount: Number(p.amount) || 0,
              method: p.method || undefined,
              docNumber: o.po_number,
            }))
          )
          .catch(() => [] as StatementPaymentEntry[])
      )
    ).then((all) => all.flat());
    Promise.all([
      perDoc,
      advances.forParty("supplier", supplier.id).catch(() => []),
    ])
      .then(([pays, advs]) => {
        if (!alive) return;
        setStmtPayments(pays);
        setStmtAdvances(
          advs
            // Negative rows are internal allocations, not new money.
            .filter((a) => Number(a.amount) > 0)
            .map((a) => ({
              date: (a.paid_at || "").slice(0, 10),
              amount: Number(a.amount) || 0,
              note: a.note || undefined,
            }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setStmtExtrasLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, docKey]);

  /** Supplier currency: dominant across its POs, else the company default. */
  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of ledgerDocs) {
      const c = (o.currency || "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top || company?.currency || "AED";
  }, [ledgerDocs, company]);

  /** The all-time payable statement — one derivation behind the KPI grid,
   *  the Purchases & Payments ledger, the download panel and the preview.
   *  (Suppliers have no standalone payment receipts — same as the modal.) */
  const built = useMemo(() => {
    const docEntries: StatementDocEntry[] = ledgerDocs.map((o) => ({
      number: o.po_number,
      date: o.order_date,
      total: o.total,
      taxRate: o.tax_rate ?? 0,
    }));
    return buildStatement({
      kind: "supplier",
      company: {
        name: company?.name || "Company",
        address:
          [company?.address, company?.city].filter(Boolean).join("\n") ||
          undefined,
        trn: company?.trn || undefined,
        email: company?.email || undefined,
        phone: company?.phone || undefined,
      },
      party: {
        name: supplier?.name || "Supplier",
        contact: supplier?.contact_person,
        trn: supplier?.tax_id,
        email: supplier?.email,
        address: supplier?.address,
      },
      currency,
      period: { from: null, to: localYmd(new Date()) },
      docs: docEntries,
      payments: stmtPayments,
      advances: stmtAdvances,
    });
  }, [ledgerDocs, company, supplier, currency, stmtPayments, stmtAdvances]);

  const stmt = built.data;
  /** + = we still owe the supplier, − = we paid ahead (advance/credit). */
  const netBalance = stmt.closingBalance;
  const paymentCount = stmt.lines.filter((l) => l.credit > 0).length;

  /** Period-over-period purchases: last 90 days vs the prior 90 days, from
   *  real PO dates. Null when the prior window has no purchases — the KPI
   *  then shows a muted "No prior period" instead of an invented figure. */
  const purchaseDelta = useMemo(() => {
    const now = new Date();
    const d90 = new Date(now);
    d90.setDate(d90.getDate() - 90);
    const d180 = new Date(now);
    d180.setDate(d180.getDate() - 180);
    const from90 = localYmd(d90);
    const from180 = localYmd(d180);
    const today = localYmd(now);
    let last = 0;
    let prior = 0;
    for (const o of ledgerDocs) {
      const day = (o.order_date || "").slice(0, 10);
      if (!day || o.total <= 0) continue;
      if (day >= from90 && day <= today) last += o.total;
      else if (day >= from180 && day < from90) prior += o.total;
    }
    if (prior <= 0) return null;
    return ((last - prior) / prior) * 100;
  }, [ledgerDocs]);

  const tplMeta = statementTemplates[tplKey];
  const ActiveTpl = tplMeta.Component;
  /** Ledger rows: the most recent 10 by default, all when toggled. */
  const ledgerRows = showAllLedger ? stmt.lines : stmt.lines.slice(-10);

  /** A4 slices for the off-screen PDF export stack (same pattern as the
   *  StatementModal export). */
  const exportPages = useMemo<StatementPage[]>(() => {
    const lines = stmt.lines;
    const slices = tplMeta.paginates ? paginateStatementLines(lines) : [lines];
    return slices.map((slice, i) => ({
      lines: slice,
      page: i + 1,
      pages: slices.length,
      continuation: i > 0,
      last: i === slices.length - 1,
    }));
  }, [stmt.lines, tplMeta.paginates]);

  const copyStatementLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied");
  };

  const emailStatement = () => {
    shareVia("email", {
      email: supplier?.email,
      text: `Statement of account for ${supplier?.name || "Supplier"} — balance ${money(netBalance, currency)}. View: ${window.location.href}`,
      url: `Statement of account — ${supplier?.name || "Supplier"}`,
    });
  };

  const downloadStatementPdf = async () => {
    const el = exportRef.current;
    if (!el) {
      window.print();
      return;
    }
    setExporting(true);
    try {
      await downloadElementAsPdf(
        el,
        `Statement-${(supplier?.name || "supplier").replace(/[^\w.-]+/g, "_").slice(0, 40)}-${localYmd(new Date())}`
      );
    } finally {
      setExporting(false);
    }
  };

  const subtitle = useMemo(() => {
    if (!supplier) return "Supplier profile & purchasing";
    const parts: string[] = [];
    if (supplier.contact_person) parts.push(supplier.contact_person);
    if (supplier.created_at)
      parts.push(`Supplier since ${new Date(supplier.created_at).getFullYear()}`);
    return parts.join(" · ") || "Supplier profile & purchasing";
  }, [supplier]);

  const visibleOrders = showAllPos ? myOrders : myOrders.slice(0, 10);

  /* ---------- Row actions (all backed by real api calls) ---------- */

  const viewPo = async (o: PoSummary) => {
    try {
      const poDoc = await pos.get(o.id);
      setQv({
        title: poDoc.po_number,
        subtitle: `${poDoc.supplier_name || supplier?.name || "Supplier"} · Ordered ${fmtDate(poDoc.order_date)}`,
        badge: <Badge tone={statusTone(poDoc.status)}>{poDoc.status}</Badge>,
        meta: [
          { label: "Ordered", value: fmtDate(poDoc.order_date) },
          { label: "Expected", value: fmtDate(poDoc.expected_date) },
          { label: "Currency", value: poDoc.currency || "AED" },
          { label: "Template", value: poDoc.template },
          { label: "Last updated", value: fmtDate(poDoc.updated_at) },
        ],
        items: poDoc.items.map((i) => ({
          desc: i.description,
          qty: i.quantity,
          price: i.unit_cost,
        })),
        total: poDoc.total,
        currency: poDoc.currency || "AED",
        notes: poDoc.notes || undefined,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sharePo = async (kind: ShareKind, o: PoSummary) => {
    try {
      const token = await pos.publicLink(o.id);
      const url = `${location.origin}${location.pathname}#/portal/${token}`;
      const text = `Purchase order ${o.po_number} — ${aed(o.total)}. View online: ${url}`;
      shareVia(kind, {
        phone: supplier?.phone,
        email: supplier?.email,
        text,
        url,
      });
      if (kind === "copyLink") toast.success("Public PO link copied");
      reload(); // publicLink flips the doc's shared flag
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deletePo = async (o: PoSummary) => {
    const ok = await confirm({
      title: "Delete purchase order",
      message: `Delete ${o.po_number}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pos.remove(o.id);
      toast.success(`Deleted ${o.po_number}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!loading && !supplier) {
    return (
      <div className="animate-fade-up">
        <Link to="/suppliers" className="btn-ghost h-9 inline-flex mb-6">
          <ArrowLeft size={15} /> Back to Suppliers
        </Link>
        <Card className="text-center py-16">
          <p className="text-lg font-medium text-ink">Supplier not found</p>
          <p className="text-sm text-brand-500 mt-2">
            This supplier may have been removed.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up pb-10">
      {/* DEMO parity header: square back button, 22px title + status pill,
          13px subtitle, right-aligned actions */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Link
          to="/suppliers"
          aria-label="Back to Suppliers"
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-muted-foreground hover:text-foreground border border-border shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight truncate">
              {supplier?.name || "Supplier"}
            </h1>
            {supplier?.shared && <Badge tone="info">Shared</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              document
                .getElementById("download-panel")
                ?.scrollIntoView({ behavior: "smooth" })
            }
            disabled={!supplier}
            className="h-8 px-3 rounded-md text-[13px] font-medium inline-flex items-center gap-1.5 bg-amber-400 text-neutral-900 hover:bg-amber-300 border border-amber-500/60"
          >
            <Download className="h-3.5 w-3.5" /> Download statement
          </button>
          <button
            onClick={() => setStmtOpen(true)}
            disabled={!supplier}
            className="btn-ghost h-8 inline-flex gap-1.5"
          >
            <FileText className="h-3.5 w-3.5" /> Statement
          </button>
          <button
            onClick={() => setEditOpen(true)}
            disabled={!supplier}
            className="btn-ghost h-8 inline-flex gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          {supplier?.email && (
            <button
              onClick={() =>
                shareVia("email", {
                  email: supplier.email,
                  url: supplier.name,
                })
              }
              className="btn-ghost h-8 inline-flex gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </button>
          )}
          <button
            onClick={() => nav("/purchase-orders?new=1")}
            className="btn-primary h-8 inline-flex gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> New PO
          </button>
        </div>
      </div>

      {/* DEMO parity: joined 4-cell KPI grid — identity + statement metrics
          sharing hairline dividers; every figure derives from buildStatement. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card mb-5">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-lg bg-sky-500/10 text-sky-500 grid place-items-center shrink-0">
              <Building2 className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-muted-foreground">Supplier</div>
              <div className="text-[14px] font-semibold text-foreground truncate">
                {supplier?.name || "—"}
              </div>
              <div className="text-[11.5px] text-muted-foreground truncate">
                TRN {supplier?.tax_id || "—"}
              </div>
            </div>
          </div>
        </div>
        <KpiCell
          className="border-b lg:border-b-0 lg:border-r border-border"
          label="Total purchases"
          value={money(stmt.totalDebit, currency)}
          hint={
            purchaseDelta == null ? (
              "No prior period"
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  purchaseDelta >= 0 ? "text-emerald-500" : "text-danger"
                )}
              >
                {purchaseDelta >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {purchaseDelta >= 0 ? "+" : ""}
                {purchaseDelta.toFixed(1)}% vs prior 90 days
              </span>
            )
          }
        />
        <KpiCell
          className="border-b lg:border-b-0 lg:border-r border-border"
          label="Paid"
          value={money(stmt.totalCredit, currency)}
          hint={
            paymentCount > 0
              ? `${paymentCount} settlement${paymentCount === 1 ? "" : "s"}`
              : "No payments yet"
          }
        />
        <KpiCell
          label="Net balance"
          value={money(netBalance, currency)}
          valueClass={
            netBalance > 0.005
              ? "text-danger"
              : netBalance < -0.005
                ? "text-success"
                : undefined
          }
          hint={
            <span className="inline-flex items-center gap-1">
              {netBalance > 0.005 ? (
                <>
                  <TrendingDown className="h-3 w-3" /> You owe
                </>
              ) : netBalance < -0.005 ? (
                <>
                  <TrendingUp className="h-3 w-3" /> Advance held
                </>
              ) : (
                "All settled"
              )}
            </span>
          }
        />
      </div>

      {/* DEMO parity: joined Contact + Purchases & Payments card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card mb-5">
        <div className="lg:col-span-1 border-b lg:border-b-0 lg:border-r border-border p-5">
          <div className="text-[14px] font-semibold text-foreground mb-3">
            Contact
          </div>
          <Info
            icon={User}
            label="Contact person"
            value={supplier?.contact_person || "—"}
          />
          <Info icon={Mail} label="Email" value={supplier?.email || "—"} />
          <Info icon={Phone} label="Phone" value={supplier?.phone || "—"} />
          <Info icon={BadgeCheck} label="TRN" value={supplier?.tax_id || "—"} />
          <Info icon={MapPin} label="Address" value={supplier?.address || "—"} />

          {/* Notes */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] text-muted-foreground">Notes</div>
              {!editingNotes && (
                <button
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                  onClick={() => {
                    setNotesDraft(supplier?.notes || "");
                    setEditingNotes(true);
                  }}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  className="textarea text-xs"
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Add notes about this supplier..."
                />
                <div className="flex gap-1.5">
                  <button
                    className="btn-primary text-xs !py-1 !px-2.5"
                    disabled={savingNotes}
                    onClick={saveNotes}
                  >
                    <Save size={11} /> {savingNotes ? "..." : "Save"}
                  </button>
                  <button
                    className="btn-ghost text-xs !py-1 !px-2.5"
                    onClick={() => setEditingNotes(false)}
                  >
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {supplier?.notes || "No notes yet."}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-foreground">
                Purchases & Payments
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                Period {stmt.period.from} → {stmt.period.to}
              </div>
            </div>
            {stmt.lines.length > 10 && (
              <button
                onClick={() => setShowAllLedger((v) => !v)}
                className="text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {showAllLedger ? "Show recent" : "Show all"}
              </button>
            )}
          </div>
          <div className="overflow-x-auto overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-medium text-[11.5px]">Date</th>
                  <th className="px-5 py-2 font-medium text-[11.5px]">Description</th>
                  <th className="px-5 py-2 font-medium text-[11.5px]">Ref</th>
                  <th className="px-5 py-2 font-medium text-[11.5px] text-right">Purchase</th>
                  <th className="px-5 py-2 font-medium text-[11.5px] text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {stmtExtrasLoading && ledgerRows.length === 0 ? (
                  Array.from({ length: 3 }).map((_, r) => (
                    <tr key={`lsk${r}`} className="border-b border-border last:border-0">
                      {Array.from({ length: 5 }).map((_, c) => (
                        <td key={c} className="px-5 py-3">
                          <Skeleton className="h-4 w-[70%]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : ledgerRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-10 text-center text-[13px] text-muted-foreground"
                    >
                      No transactions yet
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map((l, i) => (
                    <tr
                      key={`${l.ref}-${i}`}
                      className="border-b border-border last:border-0 hover:bg-hover"
                    >
                      <td className="px-5 py-2 text-foreground whitespace-nowrap">
                        {l.date}
                      </td>
                      <td className="px-5 py-2 text-foreground truncate max-w-[280px]">
                        {l.description}
                      </td>
                      <td className="px-5 py-2 text-muted-foreground">
                        {l.ref || "—"}
                      </td>
                      <td className="px-5 py-2 text-right text-foreground tabular-nums">
                        {l.debit ? money(l.debit, currency) : "—"}
                      </td>
                      <td className="px-5 py-2 text-right text-emerald-500 tabular-nums">
                        {l.credit ? money(l.credit, currency) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DEMO parity: download panel — template picker + selected-template
          summary. The header's amber button smooth-scrolls here. */}
      <div
        id="download-panel"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5 scroll-mt-4"
      >
        <div className="lg:col-span-2 rounded-xl border border-border bg-card">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[14px] font-semibold text-foreground">
                Download supplier statement
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                Pick a template — preview updates instantly
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => window.print()}
                className="btn-ghost h-8 inline-flex gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button
                onClick={copyStatementLink}
                className="btn-ghost h-8 inline-flex gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" /> Copy link
              </button>
              <button
                onClick={emailStatement}
                disabled={!supplier}
                className="btn-ghost h-8 inline-flex gap-1.5"
              >
                <Send className="h-3.5 w-3.5" /> Email
              </button>
              <button
                onClick={downloadStatementPdf}
                disabled={!supplier || exporting || !built.hasContent}
                className="h-8 px-3 rounded-md text-[13px] font-medium inline-flex items-center gap-1.5 bg-amber-400 text-neutral-900 hover:bg-amber-300 border border-amber-500/60 disabled:opacity-50"
              >
                <FileDown className="h-3.5 w-3.5" />{" "}
                {exporting ? "Preparing…" : "Download PDF"}
              </button>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <div className="flex items-stretch gap-3">
              {statementTemplateList.map((t) => (
                <StatementThumb
                  key={t.key}
                  template={t}
                  active={tplKey === t.key}
                  onClick={() => setTplKey(t.key)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[12px] text-muted-foreground uppercase tracking-wider">
              Selected template
            </div>
            <div className="text-[16px] font-semibold text-foreground mt-1">
              {tplMeta.name}
            </div>
            <div className="text-[12.5px] text-muted-foreground mt-1 px-3">
              {tplMeta.desc}
            </div>
            <div className="mt-3 text-[11.5px] text-muted-foreground">
              Includes: {stmt.lines.length} entries · balance{" "}
              {money(netBalance, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* DEMO parity: live preview of the selected statement template */}
      <div className="rounded-xl border border-border bg-card p-4 mb-5">
        <div className="text-[13px] text-muted-foreground mb-3">
          Live preview — how the exported {tplMeta.name} will look
        </div>
        {stmtExtrasLoading && !built.hasContent ? (
          <Skeleton className="h-[420px] w-full" />
        ) : !built.hasContent ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">
            No statement activity yet — the preview appears once this supplier
            has purchase orders or payments on record.
          </div>
        ) : (
          <FitPreview baseWidth={794} zoom={100} padding={0}>
            <ActiveTpl data={stmt} />
          </FitPreview>
        )}
      </div>

      {/* Off-screen A4 stack captured for the PDF export — every slice a real
          page (same pattern as the StatementModal export). */}
      {built.hasContent && (
        <div
          ref={exportRef}
          aria-hidden
          className="fixed left-[-99999px] top-0 pointer-events-none"
          style={{ width: 794, background: "#fff" }}
        >
          {exportPages.map((pg) => (
            <div
              key={pg.page}
              className="bg-white"
              style={{ width: 794, minHeight: 1123 }}
            >
              <ActiveTpl data={stmt} page={pg} />
            </div>
          ))}
        </div>
      )}

      {/* Purchase orders — full table in its own card (its old joined-card
          slot now holds the Purchases & Payments ledger). */}
      <div className="border border-border rounded-xl overflow-hidden bg-card mb-5">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-foreground">
              Purchase orders
            </div>
            <div className="text-[12.5px] text-muted-foreground">
              {num(myOrders.length)} total · {num(openCount)} open
            </div>
          </div>
          {myOrders.length > 10 && (
            <button
              onClick={() => setShowAllPos((v) => !v)}
              className="text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              {showAllPos ? "Show recent" : "Show all"}
            </button>
          )}
        </div>
        <div className="overflow-x-auto overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="text-left border-b border-border">
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                  PO #
                </th>
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                  Ordered
                </th>
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                  Expected
                </th>
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                  Status
                </th>
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                  Total
                </th>
                <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && myOrders.length === 0 ? (
                Array.from({ length: 3 }).map((_, r) => (
                  <tr key={`sk${r}`} className="border-b border-border last:border-0">
                    {Array.from({ length: 6 }).map((_, c) => (
                      <td key={c} className="px-5 py-3">
                        <Skeleton className="h-4 w-[70%]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : visibleOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-[13px] text-muted-foreground"
                  >
                    No purchase orders for this supplier
                  </td>
                </tr>
              ) : (
                visibleOrders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-border last:border-0 hover:bg-hover"
                  >
                    <td className="px-5 py-3 font-medium text-foreground whitespace-nowrap">
                      {o.po_number}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(o.order_date)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(o.expected_date)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right text-foreground tabular-nums">
                      {aed(o.total)}
                    </td>
                    <td className="px-5 py-3">
                      <RowActions
                        onView={() => viewPo(o)}
                        onSend={{
                          whatsapp: () => sharePo("whatsapp", o),
                          email: () => sharePo("email", o),
                          sms: () => sharePo("sms", o),
                          copyLink: () => sharePo("copyLink", o),
                        }}
                        onDelete={() => deletePo(o)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Advance paid to supplier */}
      {supplier && (
        <div className="mb-5">
          <AdvanceCard
            partyType="supplier"
            partyId={supplier.id}
            partyName={supplier.name}
            outstanding={Math.max(0, totalValue - receivedValue)}
          />
        </div>
      )}

      {/* Bank details */}
      {supplier && (
        <div className="mb-5">
          <PartyBankDetails
            value={supplier.bank_details}
            onSave={async (bank) => {
              await suppliersApi.update(supplier.id, { bank_details: bank });
              setList((prev) =>
                prev.map((s) => (s.id === supplier.id ? { ...s, bank_details: bank } : s))
              );
            }}
          />
        </div>
      )}

      {/* Activity Timeline */}
      {supplier && (
        <Section title="Activity timeline">
          <div className="flex h-[440px] flex-col">
            <ActivityTimeline relatedTo={supplier.name} />
          </div>
        </Section>
      )}

      <QuickViewModal open={!!qv} onClose={() => setQv(null)} data={qv} />

      {supplier && (
        <StatementModal
          open={stmtOpen}
          onClose={() => setStmtOpen(false)}
          partyType="supplier"
          party={{
            id: supplier.id,
            name: supplier.name,
            contact: supplier.contact_person,
            trn: supplier.tax_id,
            email: supplier.email,
            address: supplier.address,
          }}
          docs={stmtDocs}
        />
      )}

      <EditSupplierModal
        supplier={supplier ?? null}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          reload();
        }}
      />
    </div>
  );
}

/** Compact edit form for the header "Edit" action — same save path
 *  (suppliers.update) and payload idioms as the Suppliers page modal. */
function EditSupplierModal({
  supplier,
  open,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const blank = {
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    address: "",
    tax_id: "",
  };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(
      supplier
        ? {
            name: supplier.name ?? "",
            contact_person: supplier.contact_person ?? "",
            email: supplier.email ?? "",
            phone: supplier.phone ?? "",
            address: supplier.address ?? "",
            tax_id: supplier.tax_id ?? "",
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);

  const nameErr = !f.name.trim();

  const save = async () => {
    if (!supplier) return;
    setTouched(true);
    if (nameErr) return;
    setSaving(true);
    try {
      await suppliersApi.update(supplier.id, {
        name: f.name.trim(),
        contact_person: f.contact_person.trim() || undefined,
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        address: f.address.trim() || undefined,
        tax_id: f.tax_id.trim() || undefined,
      });
      toast.success("Supplier updated.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit supplier">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *">
          <input
            className={cn("input", touched && nameErr && "border-danger")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Contact person">
          <input
            className="input"
            value={f.contact_person}
            onChange={(e) => setF({ ...f, contact_person: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field label="Tax ID / TRN">
          <input
            className="input"
            value={f.tax_id}
            onChange={(e) => setF({ ...f, tax_id: e.target.value })}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <textarea
              className="input"
              rows={2}
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
        <button onClick={onClose} className="btn-ghost h-8">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary h-8 inline-flex gap-1.5"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
