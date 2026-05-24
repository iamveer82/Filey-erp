import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  User,
  PackageCheck,
  Wallet,
  ClipboardList,
} from "lucide-react";
import {
  suppliers as suppliersApi,
  pos,
  type Supplier,
  type PoSummary,
} from "../lib/api";
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  statusTone,
} from "../components/ui";
import { aed, num, fmtDate } from "../lib/format";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-bold text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PoSummary[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([suppliersApi.list(), pos.list()])
      .then(([ss, ps]) => {
        if (!alive) return;
        setList(ss);
        setOrders(ps);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const supplier = useMemo(
    () => list.find((s) => String(s.id) === id),
    [list, id]
  );

  const myOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (supplier != null && o.supplier_id === supplier.id) ||
          (supplier != null && o.supplier_name === supplier.name)
      ),
    [orders, supplier]
  );

  const totalValue = myOrders.reduce((s, o) => s + o.total, 0);
  const openCount = myOrders.filter(
    (o) => !["received", "cancelled"].includes(o.status.toLowerCase())
  ).length;

  if (!loading && !supplier) {
    return (
      <div className="animate-fade-up">
        <Link to="/suppliers" className="btn-ghost h-9 inline-flex mb-6">
          <ArrowLeft size={15} /> Back to Suppliers
        </Link>
        <div className="card text-center py-16">
          <p className="text-lg font-bold text-ink">Supplier not found</p>
          <p className="text-sm text-brand-500 mt-2">
            This supplier may have been removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Link to="/suppliers" className="btn-ghost h-9 inline-flex mb-4">
        <ArrowLeft size={15} /> Back to Suppliers
      </Link>
      <PageHeader
        title={supplier?.name || "Supplier"}
        subtitle={supplier?.contact_person || "Supplier profile & purchasing"}
        action={
          supplier?.shared ? <Badge tone="info">Shared</Badge> : undefined
        }
      />

      <div className="grid lg:grid-cols-4 gap-4 mb-5">
        <div className="card lg:col-span-1">
          <p className="stat-label mb-3">Contact</p>
          <ul className="space-y-2.5 text-sm">
            {supplier?.contact_person && (
              <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
                <User size={15} className="text-brand-400 shrink-0" />
                <span className="truncate">{supplier.contact_person}</span>
              </li>
            )}
            <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
              <Mail size={15} className="text-brand-400 shrink-0" />
              <span className="truncate">{supplier?.email || "—"}</span>
            </li>
            <li className="flex items-center gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
              <Phone size={15} className="text-brand-400 shrink-0" />
              <span className="truncate">{supplier?.phone || "—"}</span>
            </li>
            <li className="flex items-start gap-2.5 text-brand-700 dark:text-[#DDE0E4]">
              <MapPin size={15} className="text-brand-400 shrink-0 mt-0.5" />
              <span>{supplier?.address || "—"}</span>
            </li>
          </ul>
          {supplier?.notes && (
            <p className="text-xs text-brand-500 mt-4 border-t border-brand-100 dark:border-[#2A2C33] pt-3">
              {supplier.notes}
            </p>
          )}
        </div>
        <div className="lg:col-span-3 grid sm:grid-cols-3 gap-4">
          <StatCard
            label="Purchase orders"
            value={num(myOrders.length)}
            hint={`${openCount} open`}
            icon={<ClipboardList size={18} />}
          />
          <StatCard
            label="Total ordered"
            value={aed(totalValue)}
            hint="Across all POs"
            icon={<Wallet size={18} />}
          />
          <StatCard
            label="Open POs"
            value={num(openCount)}
            hint={openCount > 0 ? "Awaiting receipt" : "All received"}
            icon={<PackageCheck size={18} />}
          />
        </div>
      </div>

      <Section title="Purchase orders">
        <DataTable<PoSummary>
          rows={myOrders}
          loading={loading}
          empty="No purchase orders for this supplier"
          columns={[
            {
              key: "number",
              label: "PO",
              render: (o) => (
                <span className="font-semibold text-ink">{o.po_number}</span>
              ),
            },
            {
              key: "ordered",
              label: "Ordered",
              render: (o) => fmtDate(o.order_date),
            },
            {
              key: "expected",
              label: "Expected",
              render: (o) => fmtDate(o.expected_date),
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
    </div>
  );
}
