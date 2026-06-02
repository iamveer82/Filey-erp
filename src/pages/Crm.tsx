import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserCheck,
  UserPlus,
  Target,
  TrendingUp,
  Plus,
  CalendarDays,
  Download,
  Upload,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  crm,
  Opportunity,
  CrmCustomer,
  Activity,
  Lead,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import ImportCsvModal from "../components/ImportCsvModal";
import DealDrawer from "../components/DealDrawer";
import PipelineBoard from "../components/PipelineBoard";
import { aed, num, fmtDate, cn } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  InfoCard,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from "../components/ui";

export default function Crm() {
  const nav = useNavigate();
  const { toast } = useUI();
  const [view, setView] = useState<"dashboard" | "pipeline">("dashboard");
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return Promise.all([
      crm.customers().then(setCustomers),
      crm.opportunities().then(setOpps),
      crm.leads().then(setLeads),
      crm.activities().then(setActs),
    ])
      .catch((e) =>
        setError(`Could not load CRM: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useLiveSync(load);

  const now = Date.now();
  const newCount = customers.filter(
    (c) =>
      c.created_at &&
      now - new Date(c.created_at).getTime() < 30 * 86400000
  ).length;
  const inactive = (c: CrmCustomer) =>
    (c.segment ?? "").toLowerCase().includes("inactive");
  const activeCount = customers.filter((c) => !inactive(c)).length;
  const pipelineValue = opps
    .filter((o) => !["won", "lost"].includes(o.stage))
    .reduce((s, o) => s + o.value, 0);

  // Real trend: new customers per month over the last 6 months.
  const trend = useMemo(() => {
    const n = new Date();
    const buckets: { name: string; key: string; v: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
      buckets.push({
        name: d.toLocaleString("en", { month: "short" }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
        v: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const c of customers) {
      if (!c.created_at) continue;
      const d = new Date(c.created_at);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.v += 1;
    }
    return buckets.map(({ name, v }) => ({ name, v }));
  }, [customers]);

  const funnel = useMemo(() => {
    const sum = (st: string) =>
      opps
        .filter((o) => o.stage === st)
        .reduce((a, o) => a + o.value, 0);
    const cnt = (st: string) =>
      opps.filter((o) => o.stage === st).length;
    return [
      {
        label: "Leads",
        n: leads.filter(
          (l) => !["converted", "lost"].includes(l.status)
        ).length,
        v: 0,
        c: "bg-primary-400",
      },
      {
        label: "Qualified",
        n: cnt("qualification"),
        v: sum("qualification"),
        c: "bg-secondary-400",
      },
      {
        label: "Proposal",
        n: cnt("proposal"),
        v: sum("proposal"),
        c: "bg-info",
      },
      {
        label: "Negotiation",
        n: cnt("negotiation"),
        v: sum("negotiation"),
        c: "bg-warning",
      },
      { label: "Won", n: cnt("won"), v: sum("won"), c: "bg-success" },
    ];
  }, [opps, leads]);
  const funnelMax = Math.max(1, ...funnel.map((f) => f.n));

  const topCustomers = useMemo(() => {
    return customers
      .map((c) => {
        const key = (c.company || c.name || "").toLowerCase();
        const theirs = opps.filter(
          (o) => o.customer_name.toLowerCase() === key
        );
        return {
          c,
          orders: theirs.length,
          spent: theirs.reduce((s, o) => s + o.value, 0),
        };
      })
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);
  }, [customers, opps]);

  const tasks = acts.filter((a) => !a.done).slice(0, 6);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="CRM"
        subtitle="Manage relationships, track interactions and grow your business"
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost"
              aria-label="Export customers"
              onClick={() =>
                downloadCsv(
                  "customers",
                  customers as unknown as Record<string, unknown>[],
                  [
                    { key: "name", label: "Name" },
                    { key: "company", label: "Company" },
                    { key: "email", label: "Email" },
                    { key: "phone", label: "Phone" },
                    { key: "address", label: "Address" },
                    { key: "segment", label: "Segment" },
                  ]
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button className="btn-ghost" aria-label="Import customers" onClick={() => setImportOpen(true)}>
              <Upload size={15} /> Import
            </button>
            <div className="flex rounded-xl bg-brand-100 dark:bg-white/5 p-1 gap-1">
              {(["dashboard", "pipeline"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${
                    view === v
                      ? "bg-white text-ink shadow-bento dark:bg-[#3A3D45] dark:text-[#F4F5F6]"
                      : "text-brand-500 hover:text-ink dark:hover:text-[#F4F5F6]"
                  }`}
                >
                  {v === "pipeline" ? "Pipeline board" : "Dashboard"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading &&
        customers.length === 0 &&
        opps.length === 0 &&
        !error && (
          <div className="card mb-4">
            <Spinner label="Loading CRM…" />
          </div>
        )}

      {view === "pipeline" ? (
        <PipelineBoard opps={opps} setOpps={setOpps} reload={load} onOpen={setSelectedOpp} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <MetricCard
              label="Total Customers"
              value={num(customers.length)}
              icon={<Users size={20} />}
            />
            <MetricCard
              label="Active Customers"
              value={num(activeCount)}
              icon={<UserCheck size={20} />}
              iconClass="bg-success/15 text-success"
            />
            <MetricCard
              label="New Customers"
              value={num(newCount)}
              icon={<UserPlus size={20} />}
              iconClass="bg-secondary-400/20 text-secondary-600"
            />
            <MetricCard
              label="Total Deals"
              value={num(opps.length)}
              icon={<Target size={20} />}
              iconClass="bg-info/15 text-info"
            />
            <MetricCard
              label="Pipeline Value"
              value={aed(pipelineValue)}
              icon={<TrendingUp size={20} />}
              iconClass="bg-primary-100 text-primary-700"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
            <InfoCard
              title="Customer Overview"
              className="lg:col-span-2"
              action={<Badge tone="neutral">This Month</Badge>}
            >
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="crm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FFD600" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#FFD600" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DEDBD2" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 12, fill: "#A39B8C" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#A39B8C" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #DEDBD2",
                        fontSize: 13,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#E0AE00"
                      strokeWidth={2.5}
                      fill="url(#crm)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </InfoCard>

            <InfoCard title="Sales Pipeline">
              <ul className="space-y-2.5">
                {funnel.map((f) => (
                  <li key={f.label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2 text-brand-600">
                        <span className={`w-2 h-2 rounded-full ${f.c}`} />
                        {f.label}
                      </span>
                      <span className="font-bold text-ink">{f.n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-brand-100 dark:bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${f.c}`}
                        style={{ width: `${(f.n / funnelMax) * 100}%` }}
                      />
                    </div>
                    {f.v > 0 && (
                      <p className="text-[11px] text-brand-400 mt-0.5 text-right">
                        {aed(f.v)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </InfoCard>

            <InfoCard title="Recent Activity">
              {acts.length === 0 ? (
                <p className="text-sm text-brand-400">No activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {acts.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex gap-2.5">
                      <span className="mt-1 w-2 h-2 rounded-full bg-primary-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-ink leading-snug truncate">
                          {a.subject}
                        </p>
                        <p className="text-[11px] text-brand-400">
                          {a.kind} · {fmtDate(a.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </InfoCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <InfoCard
              title="Top Customers"
              className="lg:col-span-3"
              action={
                <span className="text-[11px] text-brand-400">
                  Showing {topCustomers.length} of {customers.length}
                </span>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-brand-400">
                      <th className="py-2">Customer</th>
                      <th className="py-2">Email</th>
                      <th className="py-2 text-right">Deals</th>
                      <th className="py-2 text-right">Value</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.map(({ c, orders, spent }) => (
                      <tr
                        key={c.id || c.name}
                        onClick={() => c.id && nav(`/customers/${c.id}`)}
                        className={cn(
                          "border-t border-brand-100 dark:border-[#2A2C33] transition-colors",
                          c.id &&
                            "cursor-pointer hover:bg-brand-50/70 dark:hover:bg-white/5"
                        )}
                      >
                        <td className="py-2.5">
                          <p className="font-semibold text-ink">
                            {c.company || c.name}
                          </p>
                          <p className="text-[11px] text-brand-400">
                            {c.name}
                          </p>
                        </td>
                        <td className="py-2.5 text-brand-600">
                          {c.email ?? "—"}
                        </td>
                        <td className="py-2.5 text-right text-brand-600">
                          {orders}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-ink">
                          {aed(spent)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Badge tone={inactive(c) ? "danger" : "success"}>
                            {inactive(c) ? "Inactive" : "Active"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {topCustomers.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-6 text-center text-sm text-brand-400"
                        >
                          No customers yet — add one from Invoicing.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </InfoCard>

            <InfoCard
              title="Tasks & Follow Ups"
              action={
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setTaskOpen(true)}
                >
                  <Plus size={13} /> Add
                </button>
              }
            >
              <ul className="space-y-2.5">
                {tasks.length === 0 && (
                  <li className="text-sm text-brand-400">
                    Nothing due — you're all caught up.
                  </li>
                )}
                {tasks.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <button
                      aria-label="Complete task"
                      onClick={async () => {
                        try {
                          await crm.toggleActivity(a.id);
                          load();
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to toggle task");
                        }
                      }}
                      className="mt-0.5 w-4 h-4 rounded border-2 border-brand-300 hover:border-primary-400 cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink leading-snug">
                        {a.subject}
                      </p>
                      <p className="text-[11px] text-brand-400 flex items-center gap-1">
                        <CalendarDays size={11} />
                        {a.due_date ? fmtDate(a.due_date) : "No date"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </InfoCard>
          </div>
        </>
      )}

      <TaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        onSaved={() => {
          setTaskOpen(false);
          load();
        }}
      />

      <ImportCsvModal
        open={importOpen}
        title="Import customers"
        onClose={() => setImportOpen(false)}
        onImport={async (rows) => {
          for (const r of rows) {
            if (!String(r.name ?? "").trim()) continue;
            await crm.createCustomer({
              name: String(r.name ?? ""),
              company: String(r.company ?? "") || undefined,
              email: String(r.email ?? "") || undefined,
              phone: String(r.phone ?? "") || undefined,
              address: String(r.address ?? "") || undefined,
              segment: String(r.segment ?? "") || undefined,
            } as Omit<CrmCustomer, "id" | "created_at">);
          }
          load();
        }}
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "company", label: "Company" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "address", label: "Address" },
          { key: "segment", label: "Segment" },
        ]}
      />

      <DealDrawer opp={selectedOpp} onClose={() => setSelectedOpp(null)} onChange={load} />
    </div>
  );
}

/* ---------------- Pipeline board (drag & drop) ---------------- */

function TaskModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    subject: "",
    kind: "follow-up",
    due_date: "",
  });
  useEffect(() => {
    if (open) setF({ subject: "", kind: "follow-up", due_date: "" });
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="New Task / Follow-up">
      <div className="space-y-3">
        <Field label="What needs doing? *">
          <input
            className={cn("input", !f.subject.trim() && "border-danger")}
            placeholder="Follow up with Acme Corp"
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })}
          />
          {!f.subject.trim() && (
            <p className="text-[11px] text-danger mt-1">
              A task description is required.
            </p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              className="select"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
            >
              <option value="follow-up">Follow-up</option>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              className="input"
              value={f.due_date}
              onChange={(e) => setF({ ...f, due_date: e.target.value })}
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
          disabled={!f.subject.trim()}
          onClick={async () => {
            try {
              await crm.createActivity({
                kind: f.kind,
                subject: f.subject,
                due_date: f.due_date || undefined,
              } as Omit<Activity, "id" | "done" | "created_at">);
              onSaved();
            } catch (e: any) {
              toast.error(e?.message || "Failed to create task");
            }
          }}
        >
          Add Task
        </button>
      </div>
    </Modal>
  );
}
