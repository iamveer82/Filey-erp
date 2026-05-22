import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  Receipt,
  Wallet,
  ShoppingCart,
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
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  statusTone,
} from "../components/ui";
import { aed, num, fmtDate } from "../lib/format";
import CustomerNotes from "../components/CustomerNotes";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-bold text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);

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
  const outstanding = myInvoices.reduce(
    (s, d) => s + (d.balance ?? Math.max(0, d.total - (d.paid ?? 0))),
    0
  );
  const openOppValue = myOpps
    .filter((o) => !["won", "lost"].includes(o.stage.toLowerCase()))
    .reduce((s, o) => s + o.value, 0);

  if (!loading && !customer) {
    return (
      <div className="animate-fade-up">
        <Link to="/crm" className="btn-ghost h-9 inline-flex mb-6">
          <ArrowLeft size={15} /> Back to CRM
        </Link>
        <div className="card text-center py-16">
          <p className="text-lg font-bold text-ink">Customer not found</p>
          <p className="text-sm text-brand-500 mt-2">
            This customer may have been removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Link to="/crm" className="btn-ghost h-9 inline-flex mb-4">
        <ArrowLeft size={15} /> Back to CRM
      </Link>
      <PageHeader
        title={display || "Customer"}
        subtitle={customer?.segment || "Customer profile & history"}
        action={
          customer?.shared ? <Badge tone="info">Shared</Badge> : undefined
        }
      />

      <div className="grid lg:grid-cols-4 gap-4 mb-5">
        <div className="card lg:col-span-1">
          <p className="stat-label mb-3">Contact</p>
          <ul className="space-y-2.5 text-sm">
            {customer?.company && (
              <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#C8C8C8]">
                <Building2 size={15} className="text-brand-400 shrink-0" />
                <span className="truncate">{customer.company}</span>
              </li>
            )}
            <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#C8C8C8]">
              <Mail size={15} className="text-brand-400 shrink-0" />
              <span className="truncate">{customer?.email || "—"}</span>
            </li>
            <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#C8C8C8]">
              <Phone size={15} className="text-brand-400 shrink-0" />
              <span className="truncate">{customer?.phone || "—"}</span>
            </li>
            <li className="flex items-start gap-2.5 text-brand-700 dark:text-[#C8C8C8]">
              <MapPin size={15} className="text-brand-400 shrink-0 mt-0.5" />
              <span>{customer?.address || "—"}</span>
            </li>
          </ul>
        </div>
        <div className="lg:col-span-3 grid sm:grid-cols-3 gap-4">
          <StatCard
            label="Total invoiced"
            value={aed(totalInvoiced)}
            hint={`${myInvoices.length} invoice${
              myInvoices.length === 1 ? "" : "s"
            }`}
            icon={<Receipt size={18} />}
          />
          <StatCard
            label="Outstanding"
            value={aed(outstanding)}
            hint={outstanding > 0 ? "Balance due" : "All settled"}
            icon={<Wallet size={18} />}
          />
          <StatCard
            label="Orders"
            value={num(myOrders.length)}
            hint={`${myQuotes.length} quote${
              myQuotes.length === 1 ? "" : "s"
            } · open ${aed(openOppValue)}`}
            icon={<ShoppingCart size={18} />}
          />
        </div>
      </div>

      {id && <CustomerNotes customerId={id} />}

      <Section title="Invoices">
        <DataTable<InvoiceDocSummary>
          rows={myInvoices}
          loading={loading}
          empty="No invoices for this customer"
          columns={[
            {
              key: "number",
              label: "Number",
              render: (d) => (
                <span className="font-semibold text-ink">{d.number}</span>
              ),
            },
            {
              key: "issue",
              label: "Issued",
              render: (d) => fmtDate(d.issue_date),
            },
            {
              key: "status",
              label: "Status",
              render: (d) => (
                <Badge tone={statusTone(d.status)}>{d.status}</Badge>
              ),
            },
            { key: "total", label: "Total", render: (d) => aed(d.total) },
            {
              key: "balance",
              label: "Balance",
              render: (d) =>
                aed(d.balance ?? Math.max(0, d.total - (d.paid ?? 0))),
            },
          ]}
        />
      </Section>

      <Section title="Quotations">
        <DataTable<QuotationSummary>
          rows={myQuotes}
          loading={loading}
          empty="No quotations for this customer"
          columns={[
            {
              key: "number",
              label: "Number",
              render: (q) => (
                <span className="font-semibold text-ink">{q.number}</span>
              ),
            },
            {
              key: "valid",
              label: "Valid until",
              render: (q) => fmtDate(q.valid_until),
            },
            {
              key: "status",
              label: "Status",
              render: (q) => (
                <Badge tone={statusTone(q.status)}>{q.status}</Badge>
              ),
            },
            { key: "total", label: "Total", render: (q) => aed(q.total) },
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
              render: (o) => (
                <span className="font-semibold text-ink">
                  {o.order_number}
                </span>
              ),
            },
            {
              key: "date",
              label: "Date",
              render: (o) => fmtDate(o.created_at),
            },
            {
              key: "status",
              label: "Status",
              render: (o) => (
                <Badge tone={statusTone(o.status)}>{o.status}</Badge>
              ),
            },
            { key: "total", label: "Total", render: (o) => aed(o.total) },
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
                render: (o) => (
                  <span className="font-semibold text-ink">{o.title}</span>
                ),
              },
              {
                key: "stage",
                label: "Stage",
                render: (o) => (
                  <Badge tone={statusTone(o.stage)}>{o.stage}</Badge>
                ),
              },
              { key: "value", label: "Value", render: (o) => aed(o.value) },
              {
                key: "prob",
                label: "Probability",
                render: (o) => `${o.probability}%`,
              },
            ]}
          />
        </Section>
      )}
    </div>
  );
}
