import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import {
  advances,
  billing,
  pos,
  receipts as receiptsApi,
  type CompanyProfile,
} from "../../lib/api";
import { errMsg, localYmd } from "../../lib/format";
import { useUI } from "../../lib/ui";
import { EmptyState, FilterChip, Modal, Skeleton } from "../ui";
import FitPreview from "../FitPreview";
import { downloadElementAsPdf } from "../../lib/pdfTools";
import {
  paginateStatementLines,
  StatementThumb,
  statementTemplateList,
  statementTemplates,
  type StatementPage,
  type StatementPartyKind,
  type StatementTemplateKey,
} from "./StatementTemplates";
import {
  buildStatement,
  type StatementAdvanceEntry,
  type StatementDocEntry,
  type StatementPaymentEntry,
  type StatementReceiptEntry,
} from "./buildStatement";

/** Minimal doc reference the parent pages hand down (already loaded there). */
export interface StatementDocRef {
  id: number;
  number: string;
  date?: string;
  total: number;
  currency?: string;
  status?: string;
  tax_rate?: number;
}

export interface StatementPartyRef {
  id: number;
  name: string;
  contact?: string;
  trn?: string;
  email?: string;
  address?: string;
  opening_balance?: number;
}

type PeriodKey = "30d" | "90d" | "year" | "all";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

const todayYmd = () => localYmd(new Date());

function periodFrom(key: PeriodKey): string | null {
  if (key === "all") return null;
  if (key === "year") return `${new Date().getFullYear()}-01-01`;
  const d = new Date();
  d.setDate(d.getDate() - (key === "30d" ? 30 : 90));
  return localYmd(d);
}

/** Full-screen Statement of Account: period picker, the six DEMO template
 *  layouts, a live preview filled with the party's REAL ledger, and export
 *  through the house PDF pipeline (off-screen A4 stack → elementToPdfBytes,
 *  browser print via the .invoice-print sheet). */
export default function StatementModal({
  open,
  onClose,
  partyType,
  party,
  partyNames = [],
  docs,
}: {
  open: boolean;
  onClose: () => void;
  partyType: StatementPartyKind;
  party: StatementPartyRef;
  /** Names the party's standalone receipts may be filed under (customers). */
  partyNames?: string[];
  /** The party's billing docs (invoices) or purchase orders, pre-matched. */
  docs: StatementDocRef[];
}) {
  const { toast } = useUI();
  const [template, setTemplate] = useState<StatementTemplateKey>("ledger");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [payments, setPayments] = useState<StatementPaymentEntry[]>([]);
  const [receipts, setReceipts] = useState<StatementReceiptEntry[]>([]);
  const [advRows, setAdvRows] = useState<StatementAdvanceEntry[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  /** Only issued documents are ledger debits — sales drafts and draft /
   *  cancelled POs never hit the account. */
  const ledgerDocs = useMemo(
    () =>
      docs.filter((d) => {
        const st = (d.status || "").toLowerCase();
        return partyType === "customer"
          ? st !== "draft"
          : st !== "draft" && st !== "cancelled";
      }),
    [docs, partyType]
  );
  const docKey = ledgerDocs.map((d) => d.id).join(",");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);

    const mapPay = (docNumber: string) => (p: { paid_at: string; amount: number | string; method?: string | null }) => ({
      date: (p.paid_at || "").slice(0, 10),
      amount: Number(p.amount) || 0,
      method: p.method || undefined,
      docNumber,
    });

    const perDocPayments: Promise<StatementPaymentEntry[]> =
      partyType === "customer"
        ? Promise.all(
            ledgerDocs.map((d) =>
              billing
                .payments(d.id)
                .then((ps) => ps.map(mapPay(d.number)))
                .catch(() => [] as StatementPaymentEntry[])
            )
          ).then((all) => all.flat())
        : Promise.all(
            ledgerDocs.map((d) =>
              pos
                .payments(d.id)
                .then((ps) => ps.map(mapPay(d.number)))
                .catch(() => [] as StatementPaymentEntry[])
            )
          ).then((all) => all.flat());

    Promise.all([
      billing.getCompany().catch(() => null),
      perDocPayments,
      partyType === "customer"
        ? receiptsApi.list().catch(() => [])
        : Promise.resolve([]),
      advances.forParty(partyType, party.id).catch(() => []),
    ])
      .then(([co, pays, rcs, advs]) => {
        if (!alive) return;
        setCompany(co);
        setPayments(pays);
        setReceipts(
          rcs
            .filter(
              (r) =>
                (r.status || "").toLowerCase() !== "draft" &&
                partyNames.includes(r.customer_name)
            )
            .map((r) => ({
              number: r.number,
              date: (r.payment_date || "").slice(0, 10),
              amount: Number(r.amount) || 0,
            }))
        );
        setAdvRows(
          advs
            // Negative rows are advance consumptions tied to invoices
            // (`applied:inv#…`) — internal allocations, not new money.
            .filter((a) => Number(a.amount) > 0)
            .map((a) => ({
              date: (a.paid_at || "").slice(0, 10),
              amount: Number(a.amount) || 0,
              note: a.note || undefined,
            }))
        );
      })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partyType, party.id, docKey]);

  /** Party currency: the dominant currency across its documents, falling
   *  back to the company default. */
  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of ledgerDocs) {
      const c = (d.currency || "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top || company?.currency || "AED";
  }, [ledgerDocs, company]);

  const built = useMemo(() => {
    const docEntries: StatementDocEntry[] = ledgerDocs.map((d) => ({
      number: d.number,
      date: d.date,
      total: d.total,
      taxRate: d.tax_rate ?? 0,
    }));
    return buildStatement({
      kind: partyType,
      company: {
        name: company?.name || "Company",
        address:
          [company?.address, company?.city].filter(Boolean).join("\n") || undefined,
        trn: company?.trn || undefined,
        email: company?.email || undefined,
        phone: company?.phone || undefined,
      },
      party: {
        name: party.name,
        contact: party.contact,
        trn: party.trn,
        email: party.email,
        address: party.address,
        openingBalance: party.opening_balance ?? 0,
      },
      currency,
      period: { from: periodFrom(period), to: todayYmd() },
      docs: docEntries,
      payments,
      receipts,
      advances: advRows,
    });
  }, [
    ledgerDocs,
    company,
    party,
    partyType,
    currency,
    period,
    payments,
    receipts,
    advRows,
  ]);

  const meta = statementTemplates[template];
  const Active = meta.Component;
  const isEmpty = !loading && !built.hasContent;

  /** A4 slices for the off-screen export stack. */
  const exportPages = useMemo<StatementPage[]>(() => {
    const lines = built.data.lines;
    const slices = meta.paginates ? paginateStatementLines(lines) : [lines];
    return slices.map((slice, i) => ({
      lines: slice,
      page: i + 1,
      pages: slices.length,
      continuation: i > 0,
      last: i === slices.length - 1,
    }));
  }, [built.data.lines, meta.paginates]);

  const baseName = () =>
    `Statement-${party.name.replace(/[^\w.-]+/g, "_").slice(0, 40)}-${todayYmd()}`;

  const downloadPdf = async () => {
    const el = exportRef.current;
    if (!el) {
      window.print();
      return;
    }
    setExporting(true);
    try {
      await downloadElementAsPdf(el, baseName());
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Statement of account — ${party.name}`}
      size="full"
    >
      {/* Controls (never printed/exported) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-muted-foreground mr-1">Period</span>
          {PERIODS.map((p) => (
            <FilterChip
              key={p.key}
              active={period === p.key}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost h-8 inline-flex gap-1.5"
            onClick={() => window.print()}
            disabled={loading || isEmpty}
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button
            className="btn-primary h-8 inline-flex gap-1.5"
            onClick={downloadPdf}
            disabled={loading || isEmpty || exporting}
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Preparing…" : "PDF"}
          </button>
        </div>
      </div>

      <div className="no-print flex gap-2.5 overflow-x-auto pb-2 mb-4">
        {statementTemplateList.map((t) => (
          <StatementThumb
            key={t.key}
            template={t}
            active={template === t.key}
            onClick={() => setTemplate(t.key)}
          />
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={FileText}
          title="No activity for this statement"
          description={
            period === "all"
              ? `${party.name} has no ${
                  partyType === "customer"
                    ? "issued invoices, receipts or advances"
                    : "purchase orders or payments"
                } on record yet.`
              : "Nothing recorded in this period — try All time to see the full ledger."
          }
        />
      ) : (
        <>
          <FitPreview baseWidth={794} zoom={100} padding={0}>
            <Active data={built.data} />
          </FitPreview>

          {/* Off-screen A4 stack captured for the PDF export — every slice a
              real page (same pattern as the invoice export in Invoicing). */}
          <div
            ref={exportRef}
            aria-hidden
            data-no-i18n
            dir="ltr"
            className="fixed left-[-99999px] top-0 pointer-events-none"
            style={{ width: 794, background: "#fff" }}
          >
            {exportPages.map((pg) => (
              <div
                key={pg.page}
                className="bg-white"
                style={{ width: 794, minHeight: 1123 }}
              >
                <Active data={built.data} page={pg} />
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
