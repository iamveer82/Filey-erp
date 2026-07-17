import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  ShieldCheck,
  Pencil,
  Plus,
} from "lucide-react";
import {
  crm,
  billing,
  quotes,
  erp,
  type CrmCustomer,
  type InvoiceDocSummary,
  type QuotationSummary,
  type Order,
  type Opportunity,
} from "../lib/api";
import {
  DataTable,
  Badge,
  statusTone,
  Card,
  Skeleton,
  Modal,
  Field,
} from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
  type ShareKind,
} from "../components/RowActions";
import { aed, num, fmtDate, errMsg, cn } from "../lib/format";
import { useUI } from "../lib/ui";
import CustomerNotes from "../components/CustomerNotes";
import ActivityTimeline from "../components/ActivityTimeline";
import PartyBankDetails from "../components/PartyBankDetails";
import FollowUps from "../components/FollowUps";
import AdvanceCard from "../components/AdvanceCard";

// Local re-export so the edit form doesn't need a separate import (same
// helper as the Customers page — keeps phone_e164 in sync for OTP/SMS).
const toE164Local = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("971")) return "+" + digits;
  if (digits.startsWith("0") && digits.length === 10) return "+971" + digits.slice(1);
  return null;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-medium text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

/** DEMO parity: icon + label-over-value row for the Contact & tax panel. */
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

/** DEMO parity: one cell of the joined KPI strip (12px label / 24px value /
 *  11.5px hint). The wrapper supplies the shared hairlines via .joined-kpis. */
function KpiCell({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="bg-card p-5">
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

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { toast, confirm } = useUI();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [showAllInv, setShowAllInv] = useState(false);
  const [qv, setQv] = useState<QuickViewData | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      crm.customers(),
      billing.listDocs(),
      quotes.listDocs(),
      erp.orders(),
      crm.opportunities(),
    ])
      .then(([cs, inv, qs, ords, op]) => {
        if (!alive) return;
        setCustomers(cs);
        setInvoices(inv);
        setQuotations(qs);
        setOrders(ords);
        setOpps(op);
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
      crm.customers(),
      billing.listDocs(),
      quotes.listDocs(),
      erp.orders(),
      crm.opportunities(),
    ])
      .then(([cs, inv, qs, ords, op]) => {
        setCustomers(cs);
        setInvoices(inv);
        setQuotations(qs);
        setOrders(ords);
        setOpps(op);
      })
      .catch(() => {});
  };

  const customer = useMemo(
    () => customers.find((c) => String(c.id) === id),
    [customers, id]
  );

  const display = customer ? customer.company || customer.name : "";
  const names = useMemo(() => {
    const s = new Set<string>();
    if (customer) {
      s.add(customer.company || customer.name);
      s.add(customer.name);
    }
    return s;
  }, [customer]);

  const myInvoices = useMemo(
    () => invoices.filter((d) => names.has(d.customer_name)),
    [invoices, names]
  );
  const myQuotes = useMemo(
    () => quotations.filter((d) => names.has(d.customer_name)),
    [quotations, names]
  );
  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (customer != null && o.customer_id === customer.id) ||
          names.has(o.customer_name)
      ),
    [orders, names, customer]
  );
  const myOpps = useMemo(
    () => opps.filter((o) => names.has(o.customer_name)),
    [opps, names]
  );

  const totalInvoiced = myInvoices.reduce((s, d) => s + d.total, 0);
  const totalReceived = myInvoices.reduce((s, d) => s + (d.paid ?? 0), 0);
  const paidInvoices = myInvoices.filter((d) => (d.paid ?? 0) > 0).length;
  const outstanding = myInvoices.reduce(
    (s, d) => s + (d.balance ?? Math.max(0, d.total - (d.paid ?? 0))),
    0
  );
  const opening = customer?.opening_balance || 0;
  const outstandingTotal = outstanding + opening;
  const openOppValue = myOpps
    // localdb is schemaless — agent-created rows may lack stage.
    .filter((o) => !["won", "lost"].includes((o.stage || "").toLowerCase()))
    .reduce((s, o) => s + o.value, 0);

  const subtitle = useMemo(() => {
    if (!customer) return "Customer profile & history";
    const parts: string[] = [];
    if (customer.company && customer.company !== customer.name)
      parts.push(customer.name);
    if (customer.created_at)
      parts.push(`Customer since ${new Date(customer.created_at).getFullYear()}`);
    return parts.join(" · ") || "Customer profile & history";
  }, [customer]);

  const visibleInvoices = showAllInv ? myInvoices : myInvoices.slice(0, 10);

  /* ---------- Row actions (all backed by real api calls) ---------- */

  const viewInvoice = async (d: InvoiceDocSummary) => {
    try {
      const doc = await billing.getDoc(d.id);
      setQv({
        title: doc.number,
        subtitle: `${doc.customer_name} · Issued ${fmtDate(doc.issue_date)}`,
        badge: <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>,
        meta: [
          { label: "Issued", value: fmtDate(doc.issue_date) },
          { label: "Due", value: fmtDate(doc.due_date) },
          { label: "Paid", value: aed(d.paid ?? 0) },
          {
            label: "Balance",
            value: aed(d.balance ?? Math.max(0, d.total - (d.paid ?? 0))),
          },
          { label: "Template", value: doc.template },
          { label: "Currency", value: doc.currency || "AED" },
        ],
        items: doc.items.map((i) => ({
          desc: i.description,
          qty: i.qty,
          price: i.unit_price,
        })),
        total: d.total,
        currency: doc.currency || "AED",
        notes: doc.notes || undefined,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const viewQuote = async (q: QuotationSummary) => {
    try {
      const doc = await quotes.getDoc(q.id);
      setQv({
        title: doc.number,
        subtitle: `${doc.customer_name} · ${fmtDate(doc.quote_date)}`,
        badge: <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>,
        meta: [
          { label: "Quote date", value: fmtDate(doc.quote_date) },
          { label: "Valid until", value: fmtDate(doc.valid_until) },
          { label: "Template", value: doc.template },
          { label: "Sales person", value: doc.sales_person || "—" },
        ],
        items: doc.items.map((i) => ({
          desc: i.product,
          qty: i.qty,
          price: i.rate,
        })),
        total: q.total,
        currency: doc.currency || "AED",
        notes: doc.notes || undefined,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const shareInvoice = async (kind: ShareKind, d: InvoiceDocSummary) => {
    try {
      const token = await billing.publicLink(d.id);
      const url = `${location.origin}${location.pathname}#/portal/${token}`;
      const text = `Invoice ${d.number} — ${aed(d.total)}. View & pay online: ${url}`;
      shareVia(kind, {
        phone: customer?.phone_e164 || customer?.phone,
        email: customer?.email,
        text,
        url,
      });
      if (kind === "copyLink") toast.success("Public invoice link copied");
      reload(); // publicLink flips the doc's shared flag
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const shareQuote = async (kind: ShareKind, q: QuotationSummary) => {
    try {
      const token = await quotes.publicLink(q.id);
      const url = `${location.origin}${location.pathname}#/portal/${token}`;
      const text = `Quotation ${q.number} — ${aed(q.total)}. View online: ${url}`;
      shareVia(kind, {
        phone: customer?.phone_e164 || customer?.phone,
        email: customer?.email,
        text,
        url,
      });
      if (kind === "copyLink") toast.success("Public quotation link copied");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteInvoice = async (d: InvoiceDocSummary) => {
    const ok = await confirm({
      title: "Delete invoice",
      message: `Delete ${d.number}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await billing.deleteDoc(d.id);
      toast.success(`Deleted ${d.number}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteQuote = async (q: QuotationSummary) => {
    const ok = await confirm({
      title: "Delete quotation",
      message: `Delete ${q.number}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await quotes.deleteDoc(q.id);
      toast.success(`Deleted ${q.number}`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!loading && !customer) {
    return (
      <div className="animate-fade-up">
        <Link to="/customers" className="btn-ghost h-9 inline-flex mb-6">
          <ArrowLeft size={15} /> Back to Customers
        </Link>
        <Card className="text-center py-16">
          <p className="text-lg font-medium text-ink">Customer not found</p>
          <p className="text-sm text-brand-500 mt-2">
            This customer may have been removed.
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
          to="/customers"
          aria-label="Back to Customers"
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-muted-foreground hover:text-foreground border border-border shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight truncate">
              {display || "Customer"}
            </h1>
            {customer?.segment && <Badge tone="info">{customer.segment}</Badge>}
            {customer?.shared && <Badge tone="info">Shared</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditOpen(true)}
            disabled={!customer}
            className="btn-ghost h-8 inline-flex gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          {customer?.email && (
            <button
              onClick={() =>
                shareVia("email", { email: customer.email, url: display })
              }
              className="btn-ghost h-8 inline-flex gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </button>
          )}
          <button
            onClick={() => nav("/invoicing?new=1")}
            className="btn-primary h-8 inline-flex gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> New invoice
          </button>
        </div>
      </div>

      {/* DEMO parity: joined KPI strip — identity + metrics share hairlines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 joined-kpis mb-5">
        <div className="bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary-100 text-ink grid place-items-center shrink-0">
              <Building2 className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-muted-foreground">Company</div>
              <div className="text-[14px] font-semibold text-foreground truncate">
                {display || "—"}
              </div>
              <div className="text-[11.5px] text-muted-foreground truncate">
                TRN {customer?.trn || "—"}
              </div>
            </div>
          </div>
        </div>
        <KpiCell
          label="Total invoiced"
          value={aed(totalInvoiced)}
          hint={`${myInvoices.length} invoice${myInvoices.length === 1 ? "" : "s"}`}
        />
        <KpiCell
          label="Received"
          value={aed(totalReceived)}
          hint={
            paidInvoices > 0
              ? `Across ${paidInvoices} invoice${paidInvoices === 1 ? "" : "s"}`
              : "No payments yet"
          }
        />
        <KpiCell
          label="Outstanding"
          value={aed(outstandingTotal)}
          valueClass={outstandingTotal > 0 ? "text-danger" : undefined}
          hint={
            customer?.credit_limit
              ? outstandingTotal > customer.credit_limit
                ? `OVER credit limit ${aed(customer.credit_limit)}`
                : `Credit limit ${aed(customer.credit_limit)}`
              : opening !== 0
                ? `Incl. opening balance ${aed(opening)}`
                : outstanding > 0
                  ? "Balance due"
                  : "All settled"
          }
        />
        <KpiCell
          label="Orders"
          value={num(myOrders.length)}
          hint={`${myQuotes.length} quote${myQuotes.length === 1 ? "" : "s"} · open ${aed(openOppValue)}`}
        />
      </div>

      {/* DEMO parity: joined Contact & tax + Invoices card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 border border-border rounded-xl overflow-hidden bg-card mb-5">
        <div className="lg:col-span-1 border-b lg:border-b-0 lg:border-r border-border p-5">
          <div className="text-[14px] font-semibold text-foreground mb-3">
            Contact & tax
          </div>
          <Info icon={Mail} label="Email" value={customer?.email || "—"} />
          <Info icon={Phone} label="Phone" value={customer?.phone || "—"} />
          <Info icon={ShieldCheck} label="TRN" value={customer?.trn || "—"} />
          <Info icon={MapPin} label="Address" value={customer?.address || "—"} />
          <div className="mt-4">
            <div className="text-[12px] text-muted-foreground mb-1">
              Opening balance
            </div>
            <div
              className={cn(
                "text-[16px] font-semibold tabular-nums",
                opening > 0
                  ? "text-danger"
                  : opening < 0
                    ? "text-success"
                    : "text-foreground"
              )}
            >
              {aed(opening)}
              <span className="text-[11px] text-muted-foreground ml-2 font-normal">
                {opening > 0 ? "Debit — they owe" : opening < 0 ? "Credit" : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-foreground">
                Invoices
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                {num(myInvoices.length)} total · {aed(outstanding)} due
              </div>
            </div>
            {myInvoices.length > 10 && (
              <button
                onClick={() => setShowAllInv((v) => !v)}
                className="text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {showAllInv ? "Show recent" : "Show all"}
              </button>
            )}
          </div>
          <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-left border-b border-border">
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Number
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Issued
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                    Total
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                    Balance
                  </th>
                  <th className="px-5 py-2.5 text-[12px] font-medium tracking-wide text-muted-foreground text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && myInvoices.length === 0 ? (
                  Array.from({ length: 3 }).map((_, r) => (
                    <tr key={`sk${r}`} className="border-b border-border last:border-0">
                      {Array.from({ length: 6 }).map((_, c) => (
                        <td key={c} className="px-5 py-3">
                          <Skeleton className="h-4 w-[70%]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visibleInvoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-10 text-center text-[13px] text-muted-foreground"
                    >
                      No invoices for this customer
                    </td>
                  </tr>
                ) : (
                  visibleInvoices.map((d) => {
                    const balance =
                      d.balance ?? Math.max(0, d.total - (d.paid ?? 0));
                    return (
                      <tr
                        key={d.id}
                        className="border-b border-border last:border-0 hover:bg-hover"
                      >
                        <td className="px-5 py-3 font-medium text-foreground whitespace-nowrap">
                          {d.number}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                          {fmtDate(d.issue_date)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right text-foreground tabular-nums">
                          {aed(d.total)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          <span
                            className={
                              balance > 0
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {aed(balance)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <RowActions
                            onView={() => viewInvoice(d)}
                            onSend={{
                              whatsapp: () => shareInvoice("whatsapp", d),
                              email: () => shareInvoice("email", d),
                              sms: () => shareInvoice("sms", d),
                              copyLink: () => shareInvoice("copyLink", d),
                            }}
                            onDelete={() => deleteInvoice(d)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {customer && (
        <div className="mb-5">
          <AdvanceCard
            partyType="customer"
            partyId={customer.id}
            partyName={display}
            outstanding={outstanding}
          />
        </div>
      )}

      {id && (
        <div className="mb-5">
          <FollowUps customerId={Number(id)} customerName={display} />
        </div>
      )}

      {customer && (
        <div className="mb-5">
          <PartyBankDetails
            value={customer.bank_details}
            onSave={async (bank) => {
              await crm.updateCustomer(customer.id, { bank_details: bank });
              await crm.customers().then(setCustomers).catch(() => {});
            }}
          />
        </div>
      )}

      {customer && (
        <Section title="Activity timeline">
          <div className="flex h-[440px] flex-col">
            <ActivityTimeline relatedTo={display} />
          </div>
        </Section>
      )}

      {id && <CustomerNotes customerId={id} />}

      <Section title="Quotations">
        <DataTable<QuotationSummary>
          rows={myQuotes}
          loading={loading}
          empty="No quotations for this customer"
          columns={[
            {
              key: "number",
              label: "Number",
              sortValue: (q) => q.number,
              render: (q) => <span className="font-medium text-ink">{q.number}</span>,
            },
            {
              key: "valid",
              label: "Valid until",
              sortValue: (q) => q.valid_until ?? "",
              render: (q) => fmtDate(q.valid_until),
            },
            {
              key: "status",
              label: "Status",
              sortValue: (q) => q.status,
              render: (q) => <Badge tone={statusTone(q.status)}>{q.status}</Badge>,
            },
            {
              key: "total",
              label: "Total",
              sortValue: (q) => q.total,
              render: (q) => aed(q.total),
            },
            {
              key: "act",
              label: "",
              render: (q) => (
                <RowActions
                  onView={() => viewQuote(q)}
                  onSend={{
                    whatsapp: () => shareQuote("whatsapp", q),
                    email: () => shareQuote("email", q),
                    sms: () => shareQuote("sms", q),
                    copyLink: () => shareQuote("copyLink", q),
                  }}
                  onDelete={() => deleteQuote(q)}
                />
              ),
            },
          ]}
        />
      </Section>

      <Section title="Sales orders">
        <DataTable<Order>
          rows={myOrders}
          loading={loading}
          empty="No orders for this customer"
          columns={[
            {
              key: "number",
              label: "Order",
              sortValue: (o) => o.order_number,
              render: (o) => (
                <span className="font-medium text-ink">{o.order_number}</span>
              ),
            },
            {
              key: "date",
              label: "Date",
              sortValue: (o) => o.created_at ?? "",
              render: (o) => fmtDate(o.created_at),
            },
            {
              key: "status",
              label: "Status",
              sortValue: (o) => o.status,
              render: (o) => <Badge tone={statusTone(o.status)}>{o.status}</Badge>,
            },
            {
              key: "total",
              label: "Total",
              sortValue: (o) => o.total,
              render: (o) => aed(o.total),
            },
          ]}
        />
      </Section>

      {myOpps.length > 0 && (
        <Section title="Opportunities">
          <DataTable<Opportunity>
            rows={myOpps}
            columns={[
              {
                key: "title",
                label: "Title",
                sortValue: (o) => o.title,
                render: (o) => <span className="font-medium text-ink">{o.title}</span>,
              },
              {
                key: "stage",
                label: "Stage",
                sortValue: (o) => o.stage,
                render: (o) => <Badge tone={statusTone(o.stage)}>{o.stage}</Badge>,
              },
              {
                key: "value",
                label: "Value",
                sortValue: (o) => o.value,
                render: (o) => aed(o.value),
              },
              {
                key: "prob",
                label: "Probability",
                sortValue: (o) => o.probability,
                render: (o) => `${o.probability}%`,
              },
            ]}
          />
        </Section>
      )}

      <QuickViewModal open={!!qv} onClose={() => setQv(null)} data={qv} />

      <EditCustomerModal
        customer={customer ?? null}
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
 *  (crm.updateCustomer) and payload idioms as the Customers page modal. */
function EditCustomerModal({
  customer,
  open,
  onClose,
  onSaved,
}: {
  customer: CrmCustomer | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const blank = {
    name: "",
    company: "",
    trn: "",
    email: "",
    phone: "",
    address: "",
    segment: "",
    credit_limit: "",
    opening_balance: "",
  };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(
      customer
        ? {
            name: customer.name ?? "",
            company: customer.company ?? "",
            trn: customer.trn ?? "",
            email: customer.email ?? "",
            phone: customer.phone ?? "",
            address: customer.address ?? "",
            segment: customer.segment ?? "",
            credit_limit:
              customer.credit_limit != null ? String(customer.credit_limit) : "",
            opening_balance:
              customer.opening_balance != null
                ? String(customer.opening_balance)
                : "",
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer]);

  const nameErr = !f.name.trim();

  const save = async () => {
    if (!customer) return;
    setTouched(true);
    if (nameErr) return;
    setSaving(true);
    try {
      await crm.updateCustomer(customer.id, {
        name: f.name.trim(),
        company: f.company.trim() || undefined,
        trn: f.trn.trim() || undefined,
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        address: f.address.trim() || undefined,
        segment: f.segment.trim() || undefined,
        credit_limit: f.credit_limit.trim() === "" ? undefined : Number(f.credit_limit),
        opening_balance:
          f.opening_balance.trim() === "" ? undefined : Number(f.opening_balance),
        phone_e164: toE164Local(f.phone) ?? undefined,
      });
      toast.success("Customer updated.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit customer">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact name *">
          <input
            className={cn("input", touched && nameErr && "border-danger")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Company">
          <input
            className="input"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
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
        <Field label="TRN">
          <input
            className="input"
            value={f.trn}
            onChange={(e) => setF({ ...f, trn: e.target.value })}
          />
        </Field>
        <Field label="Segment">
          <input
            className="input"
            value={f.segment}
            onChange={(e) => setF({ ...f, segment: e.target.value })}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <input
              className="input"
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Credit limit (AED)">
          <input
            className="input"
            type="number"
            value={f.credit_limit}
            onChange={(e) => setF({ ...f, credit_limit: e.target.value })}
          />
        </Field>
        <Field label="Opening balance (AED)">
          <input
            className="input"
            type="number"
            value={f.opening_balance}
            onChange={(e) => setF({ ...f, opening_balance: e.target.value })}
          />
        </Field>
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
