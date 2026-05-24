import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserCheck,
  UserPlus,
  Target,
  TrendingUp,
  GripVertical,
  Plus,
  Trophy,
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
import { downloadCsv } from "../lib/csv";
import ImportCsvModal from "../components/ImportCsvModal";
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

const STAGES = [
  { id: "qualification", label: "Qualification", tone: "info" as const },
  { id: "proposal", label: "Proposal", tone: "info" as const },
  { id: "negotiation", label: "Negotiation", tone: "warn" as const },
  { id: "won", label: "Won", tone: "success" as const },
  { id: "lost", label: "Lost", tone: "danger" as const },
];
const STAGE_PROB: Record<string, number> = {
  qualification: 20,
  proposal: 45,
  negotiation: 70,
  won: 100,
  lost: 0,
};

export default function Crm() {
  const nav = useNavigate();
  const [view, setView] = useState<"dashboard" | "pipeline">("dashboard");
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
            <button className="btn-ghost" onClick={() => setImportOpen(true)}>
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
        <PipelineBoard opps={opps} setOpps={setOpps} reload={load} />
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
                        await crm.toggleActivity(a.id);
                        load();
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
    </div>
  );
}

/* ---------------- Pipeline board (drag & drop) ---------------- */

function PipelineBoard({
  opps,
  setOpps,
  reload,
}: {
  opps: Opportunity[];
  setOpps: React.Dispatch<React.SetStateAction<Opportunity[]>>;
  reload: () => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const m: Record<string, Opportunity[]> = {};
    for (const s of STAGES) m[s.id] = [];
    for (const o of opps) (m[o.stage] ??= []).push(o);
    return m;
  }, [opps]);

  const drop = async (stage: string) => {
    setOver(null);
    const id = dragId;
    setDragId(null);
    if (id == null) return;
    const opp = opps.find((o) => o.id === id);
    if (!opp || opp.stage === stage) return;
    setOpps((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, stage, probability: STAGE_PROB[stage] ?? o.probability }
          : o
      )
    );
    try {
      await crm.setOppStage(id, stage);
    } catch {
      reload();
    }
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-3">
      {STAGES.map((s) => {
        const list = byStage[s.id] ?? [];
        const total = list.reduce((a, o) => a + o.value, 0);
        return (
          <div
            key={s.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver((v) => (v === s.id ? null : v))}
            onDrop={() => drop(s.id)}
            className={`w-72 shrink-0 rounded-2xl border p-3 transition-colors ${
              over === s.id
                ? "border-primary-300 bg-primary-50 dark:bg-primary-400/10"
                : "border-brand-200 bg-brand-50/60 dark:border-[#3A3D45] dark:bg-white/[0.03]"
            }`}
          >
            <div className="flex items-center justify-between px-1 mb-3">
              <div className="flex items-center gap-2">
                <Badge tone={s.tone}>{s.label}</Badge>
                <span className="text-xs font-semibold text-brand-400">
                  {list.length}
                </span>
              </div>
              <span className="text-xs font-bold text-ink">
                {aed(total)}
              </span>
            </div>
            <div className="space-y-2 min-h-[120px]">
              {list.map((o) => (
                <div
                  key={o.id}
                  draggable
                  onDragStart={() => setDragId(o.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  className={`card !p-3 cursor-grab active:cursor-grabbing select-none ${
                    dragId === o.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical
                      size={15}
                      className="text-brand-300 mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink truncate">
                        {o.title}
                      </p>
                      <p className="text-xs text-brand-500 truncate">
                        {o.customer_name}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm font-bold text-ink">
                          {aed(o.value)}
                        </span>
                        <span className="text-[11px] font-semibold text-brand-400">
                          {o.probability}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <p className="text-center text-xs text-brand-300 py-6">
                  Drop deals here
                </p>
              )}
            </div>
          </div>
        );
      })}
      {opps.length === 0 && (
        <div className="grid place-items-center w-full py-12 text-sm text-brand-400">
          <Trophy size={20} className="mb-2 text-brand-300" />
          No opportunities yet.
        </div>
      )}
    </div>
  );
}

function TaskModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
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
            await crm.createActivity({
              kind: f.kind,
              subject: f.subject,
              due_date: f.due_date || undefined,
            } as Omit<Activity, "id" | "done" | "created_at">);
            onSaved();
          }}
        >
          Add Task
        </button>
      </div>
    </Modal>
  );
}
