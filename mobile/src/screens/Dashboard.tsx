import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles, Users, FileText } from "lucide-react";
import { billing, crm, erp } from "@shared/api";
import { aed, num } from "@shared/format";
import { Screen, Card, MetricCard, ListRow, Loading, EmptyState } from "@mobile/components/ui";

const isPosted = (s?: string | null) => s === "sent" || s === "paid";

export default function Dashboard() {
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof billing.listDocs>>>(
    [] as never
  );
  const [customers, setCustomers] = useState<Awaited<ReturnType<typeof crm.customers>>>(
    [] as never
  );
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof erp.orders>>>(
    [] as never
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([billing.listDocs("sales"), crm.customers(), erp.orders()])
      .then(([i, c, o]) => {
        setInvoices(i);
        setCustomers(c);
        setOrders(o);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const k = useMemo(() => {
    const posted = invoices.filter((i) => isPosted(i.status));
    const revenue = posted.reduce((s, i) => s + (i.total || 0), 0);
    const outstanding = invoices.reduce((s, i) => s + (i.balance ?? 0), 0);
    const recent = [...invoices]
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 5);
    return { revenue, outstanding, recent, openOrders: orders.filter((o) => (o.status || "").toLowerCase() !== "completed").length };
  }, [invoices, orders]);

  const name = "your business";

  return (
    <Screen title="Dashboard" subtitle={`Live numbers for ${name}`}>
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Revenue"
              value={aed(k.revenue)}
              change={`${num(postedCount(invoices))} invoices`}
            />
            <MetricCard
              label="Outstanding"
              value={aed(k.outstanding)}
              change={k.outstanding > 0 ? "Awaiting payment" : "All settled"}
              tone={k.outstanding > 0 ? "warn" : "up"}
            />
            <MetricCard label="Customers" value={num(customers.length)} change="In directory" />
            <MetricCard
              label="Open orders"
              value={num(k.openOrders)}
              change={k.openOrders > 0 ? "In progress" : "None"}
              tone={k.openOrders > 0 ? "warn" : "up"}
            />
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-2.5">
            <QuickAction
              to="/invoices/new"
              icon={<Plus size={18} />}
              label="Invoice"
            />
            <QuickAction
              to="/customers"
              icon={<Users size={18} />}
              label="Customers"
            />
            <QuickAction to="/agent" icon={<Sparkles size={18} />} label="Ask AI" />
          </div>

          {/* Recent invoices */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">Recent invoices</h2>
              <Link to="/invoices" className="text-[12.5px] text-muted-foreground">
                View all
              </Link>
            </div>
            {k.recent.length === 0 ? (
              <EmptyState
                icon={<FileText size={22} />}
                title="No invoices yet"
                hint="Tap New invoice to raise your first one — it takes under a minute."
              />
            ) : (
              <div className="space-y-2">
                {k.recent.map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.number}
                    subtitle={r.customer_name || "—"}
                    amount={aed(r.total || 0)}
                    status={r.status}
                    onClick={() => nav(`/invoices/${r.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Agent nudge */}
          <Card className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-foreground">Filey AI</p>
              <p className="truncate text-[12px] text-muted-foreground">
                Ask it to draft, look up or merge anything
              </p>
            </div>
            <Link to="/agent" className="btn-ghost h-9 px-3 text-[12.5px]">
              Open
            </Link>
          </Card>
        </div>
      )}
    </Screen>
  );
}

const postedCount = (rows: { status?: string | null }[]) =>
  rows.filter((r) => isPosted(r.status)).length;

function QuickAction({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="card flex flex-col items-center gap-1.5 py-3.5 text-[12px] font-medium text-foreground transition-colors active:bg-hover"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-muted">{icon}</span>
      {label}
    </Link>
  );
}
