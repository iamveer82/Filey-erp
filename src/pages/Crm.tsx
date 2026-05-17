import { useEffect, useMemo, useState } from "react";
import { Plus, GripVertical, TrendingUp, Target, Trophy } from "lucide-react";
import { crm, Opportunity } from "../lib/api";
import { aed, num } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  Badge,
  Modal,
  Field,
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
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = () =>
    crm.opportunities().then(setOpps).catch(console.error);
  useEffect(() => {
    load();
  }, []);

  const byStage = useMemo(() => {
    const m: Record<string, Opportunity[]> = {};
    for (const s of STAGES) m[s.id] = [];
    for (const o of opps) (m[o.stage] ??= []).push(o);
    return m;
  }, [opps]);

  const pipeline = opps
    .filter((o) => !["won", "lost"].includes(o.stage))
    .reduce((s, o) => s + o.value, 0);
  const won = opps
    .filter((o) => o.stage === "won")
    .reduce((s, o) => s + o.value, 0);
  const openCount = opps.filter(
    (o) => !["won", "lost"].includes(o.stage)
  ).length;

  const drop = async (stage: string) => {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (id == null) return;
    const opp = opps.find((o) => o.id === id);
    if (!opp || opp.stage === stage) return;
    // Optimistic move, then persist.
    setOpps((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, stage, probability: STAGE_PROB[stage] ?? o.probability }
          : o
      )
    );
    try {
      await crm.setOppStage(id, stage);
    } catch (e) {
      console.error(e);
      load();
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="CRM"
        subtitle="Drag opportunities across stages to update the pipeline"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New opportunity
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <MetricCard
          label="Pipeline Value"
          value={aed(pipeline)}
          icon={<TrendingUp size={20} />}
        />
        <MetricCard
          label="Open Deals"
          value={num(openCount)}
          icon={<Target size={20} />}
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
        <MetricCard
          label="Won Value"
          value={aed(won)}
          icon={<Trophy size={20} />}
          iconClass="bg-success/15 text-success"
        />
        <MetricCard
          label="Total Deals"
          value={num(opps.length)}
          icon={<Target size={20} />}
          iconClass="bg-info/15 text-info"
        />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-3">
        {STAGES.map((s) => {
          const list = byStage[s.id] ?? [];
          const total = list.reduce((sum, o) => sum + o.value, 0);
          return (
            <div
              key={s.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(s.id);
              }}
              onDragLeave={() => setOverStage((v) => (v === s.id ? null : v))}
              onDrop={() => drop(s.id)}
              className={`w-72 shrink-0 rounded-2xl border p-3 transition-colors ${
                overStage === s.id
                  ? "border-primary-300 bg-primary-50"
                  : "border-brand-200 bg-brand-50/60"
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
                      setOverStage(null);
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
      </div>

      <NewOppModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function NewOppModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: "",
    customer_name: "",
    value: 0,
    stage: "qualification",
  });
  return (
    <Modal open={open} onClose={onClose} title="New Opportunity">
      <div className="space-y-3">
        <Field label="Title">
          <input
            className="input"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="Acme — annual contract"
          />
        </Field>
        <Field label="Customer">
          <input
            className="input"
            value={f.customer_name}
            onChange={(e) =>
              setF({ ...f, customer_name: e.target.value })
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value (AED)">
            <input
              type="number"
              className="input"
              value={f.value}
              onChange={(e) => setF({ ...f, value: +e.target.value })}
            />
          </Field>
          <Field label="Stage">
            <select
              className="input"
              value={f.stage}
              onChange={(e) => setF({ ...f, stage: e.target.value })}
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!f.title.trim()}
          onClick={async () => {
            await crm.createOpportunity({
              title: f.title,
              customer_name: f.customer_name,
              value: f.value,
              stage: f.stage,
              probability: STAGE_PROB[f.stage] ?? 20,
            } as Omit<Opportunity, "id" | "created_at">);
            onSaved();
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}
