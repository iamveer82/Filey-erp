import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trophy } from "lucide-react";
import { Badge } from "./ui";
import { aed } from "../lib/format";
import { useUI } from "../lib/ui";
import type { Opportunity } from "../lib/api";

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

type Deal = Opportunity;

function SortableDealCard({
  deal,
  onClick,
}: {
  deal: Deal;
  onClick: (d: Deal) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, data: { type: "deal", deal } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={() => onClick(deal)}
      className={
        "card !p-3 cursor-grab select-none hover:shadow-bento-hover active:cursor-grabbing " +
        (isDragging ? "opacity-50" : "")
      }
    >
      <div className="flex items-start gap-2">
        <button
          {...listeners}
          className="mt-0.5 text-brand-300 hover:text-brand-500 cursor-grab active:cursor-grabbing shrink-0"
        >
          <GripVertical size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate">
            {deal.title}
          </p>
          <p className="text-xs text-brand-500 truncate">
            {deal.customer_name}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm font-bold text-ink">
              {aed(deal.value)}
            </span>
            <span className="text-[11px] font-semibold text-brand-400">
              {deal.probability}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DealCardOverlay({ deal }: { deal: Deal }) {
  return (
    <div className="card !p-3 shadow-bento-hover rotate-2 w-64">
      <div className="flex items-start gap-2">
        <GripVertical size={15} className="text-brand-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate">
            {deal.title}
          </p>
          <p className="text-xs text-brand-500 truncate">
            {deal.customer_name}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm font-bold text-ink">
              {aed(deal.value)}
            </span>
            <span className="text-[11px] font-semibold text-brand-400">
              {deal.probability}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PipelineBoard({
  opps,
  setOpps,
  reload,
  onOpen,
}: {
  opps: Deal[];
  setOpps: React.Dispatch<React.SetStateAction<Deal[]>>;
  reload: () => void;
  onOpen: (d: Deal) => void;
}) {
  const { toast } = useUI();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [addStage, setAddStage] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const byStage = useMemo(() => {
    const m: Record<string, Deal[]> = {};
    for (const s of STAGES) m[s.id] = [];
    for (const o of opps) (m[o.stage] ??= []).push(o);
    return m;
  }, [opps]);

  const activeDeal = useMemo(
    () => opps.find((o) => o.id === activeId) ?? null,
    [activeId, opps]
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id));
    setDragOverColumn(null);
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) {
      setDragOverColumn(null);
      return;
    }

    const activeId = Number(active.id);
    const overId = over.id;

    const activeDeal = opps.find((o) => o.id === activeId);
    if (!activeDeal) return;

    const overIsColumn = STAGES.some((s) => s.id === overId);
    const overDeal = opps.find((o) => o.id === Number(overId));

    let targetStage = activeDeal.stage;
    if (overIsColumn) {
      targetStage = String(overId);
    } else if (overDeal) {
      targetStage = overDeal.stage;
    }

    setDragOverColumn(targetStage !== activeDeal.stage ? targetStage : overIsColumn ? targetStage : null);

    if (targetStage !== activeDeal.stage) {
      setOpps((prev) =>
        prev.map((o) =>
          o.id === activeId
            ? {
                ...o,
                stage: targetStage,
                probability: STAGE_PROB[targetStage] ?? o.probability,
              }
            : o
        )
      );
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    setDragOverColumn(null);
    if (!over) return;

    const activeId = Number(active.id);
    const overId = over.id;

    const activeDeal = opps.find((o) => o.id === activeId);
    if (!activeDeal) return;

    const overDeal = opps.find((o) => o.id === Number(overId));

    if (overDeal && activeDeal.stage === overDeal.stage) {
      const stageItems = opps.filter((o) => o.stage === activeDeal.stage);
      const oldIndex = stageItems.findIndex((o) => o.id === activeId);
      const newIndex = stageItems.findIndex((o) => o.id === Number(overId));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(stageItems, oldIndex, newIndex);
        const otherItems = opps.filter((o) => o.stage !== activeDeal.stage);
        setOpps([...otherItems, ...reordered]);
      }
    }

    try {
      await import("../lib/api").then((m) =>
        m.crm.setOppStage(activeId, activeDeal.stage)
      );
    } catch {
      toast.error("Failed to update opportunity stage");
      reload();
    }
  };

  const quickAdd = async (stage: string) => {
    const title = addTitle.trim();
    if (!title) {
      setAddStage(null);
      return;
    }
    setAddStage(null);
    setAddTitle("");
    try {
      const { crm } = await import("../lib/api");
      await crm.createOpportunity({
        title,
        customer_name: "",
        stage,
        value: 0,
        probability: STAGE_PROB[stage] ?? 20,
      });
      reload();
    } catch {
      toast.error("Failed to create opportunity");
      reload();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-3">
        {STAGES.map((s) => {
          const list = byStage[s.id] ?? [];
          const total = list.reduce((a, o) => a + o.value, 0);
          const isOver = dragOverColumn === s.id;
          return (
            <div
              key={s.id}
              data-column={s.id}
              className={
                "w-72 shrink-0 rounded-2xl border bg-brand-50/60 dark:bg-white/[0.03] p-3 transition-colors " +
                (isOver
                  ? "border-primary-500 bg-primary-100/40"
                  : "border-brand-200 dark:border-[#3A3D45]")
              }
            >
              <div className="flex items-center justify-between px-1 mb-3">
                <div className="flex items-center gap-2">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="inline-flex items-center justify-center min-w-[22px] h-5 rounded-full bg-white dark:bg-white/10 text-[11px] font-bold text-brand-500 px-1.5 shadow-sm">
                    {list.length}
                  </span>
                </div>
                <span className="text-xs font-bold text-ink">
                  {aed(total)}
                </span>
              </div>

              <SortableContext
                items={list.map((o) => o.id)}
                strategy={verticalListSortingStrategy}
                id={s.id}
              >
                <div className="space-y-2 min-h-[120px]">
                  {list.map((o) => (
                    <SortableDealCard
                      key={o.id}
                      deal={o}
                      onClick={onOpen}
                    />
                  ))}
                  {list.length === 0 && (
                    <p className="text-center text-xs text-brand-300 py-6">
                      Drop deals here
                    </p>
                  )}
                </div>
              </SortableContext>

              <div className="mt-2">
                {addStage === s.id ? (
                  <input
                    autoFocus
                    className="input h-8 w-full text-sm"
                    placeholder="Deal name…"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    onBlur={() => quickAdd(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") quickAdd(s.id);
                      if (e.key === "Escape") {
                        setAddStage(null);
                        setAddTitle("");
                      }
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      setAddStage(s.id);
                      setAddTitle("");
                    }}
                    className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-brand-300 py-1.5 text-xs font-semibold text-brand-400 transition-colors hover:border-primary-300 hover:text-primary-600 dark:border-[#3A3D45]"
                  >
                    <Plus size={13} /> Add deal
                  </button>
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

      <DragOverlay>
        {activeDeal ? <DealCardOverlay deal={activeDeal} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
