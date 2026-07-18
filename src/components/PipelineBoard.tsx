import { useState, useMemo, useEffect, useRef } from "react";
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
import { Eye, MoreHorizontal, Plus, Trash2, Trophy } from "lucide-react";
import { aed, cn } from "../lib/format";
import { useUI } from "../lib/ui";
import type { Opportunity } from "../lib/api";

const STAGES = [
  {
    id: "qualification",
    label: "Qualification",
    pill: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    id: "proposal",
    label: "Proposal",
    pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    id: "negotiation",
    label: "Negotiation",
    pill: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "won",
    label: "Won",
    pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  { id: "lost", label: "Lost", pill: "bg-muted text-muted-foreground" },
];

const STAGE_PROB: Record<string, number> = {
  qualification: 20,
  proposal: 45,
  negotiation: 70,
  won: 100,
  lost: 0,
};

type Deal = Opportunity;

/** DEMO card body — shared by the sortable card and the drag overlay. */
function DealCardBody({ deal }: { deal: Deal }) {
  return (
    <>
      <div className="text-[13px] font-medium text-foreground truncate">
        {deal.title}
      </div>
      <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
        {deal.owner
          ? `${deal.owner} • ${deal.customer_name || "No company"}`
          : deal.customer_name || "No company"}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground tabular-nums">
          {aed(deal.value)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {deal.probability}%
        </span>
      </div>
    </>
  );
}

/**
 * RowActions-style overflow for a deal card — hover-revealed, quiet. Stops
 * pointer/click propagation so it never starts a drag or opens the drawer.
 */
function DealCardMenu({
  onView,
  onDelete,
}: {
  onView: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div
      ref={ref}
      className="relative shrink-0 -mt-0.5 -mr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Deal actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover border border-transparent hover:border-border transition-colors"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-40 rounded-md border border-border bg-card shadow-lg py-1 text-[13px]">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-hover transition-colors"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          >
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground">View details</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-hover transition-colors"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
            <span className="text-red-500">Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SortableDealCard({
  deal,
  onOpen,
  onDelete,
  suppressClick,
}: {
  deal: Deal;
  onOpen: (d: Deal) => void;
  onDelete: (d: Deal) => void;
  /** Set by the board while a real drag is in flight — swallows the trailing click. */
  suppressClick: { current: boolean };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: deal.id, data: { type: "deal", deal } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (suppressClick.current) return;
        onOpen(deal);
      }}
      className={cn(
        "group rounded-lg bg-background border border-border p-3 select-none cursor-grab active:cursor-grabbing transition-colors hover:border-muted-foreground/40",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground truncate">
            {deal.title}
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
            {deal.owner
              ? `${deal.owner} • ${deal.customer_name || "No company"}`
              : deal.customer_name || "No company"}
          </div>
        </div>
        <DealCardMenu onView={() => onOpen(deal)} onDelete={() => onDelete(deal)} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground tabular-nums">
          {aed(deal.value)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {deal.probability}%
        </span>
      </div>
    </div>
  );
}

function DealCardOverlay({ deal }: { deal: Deal }) {
  return (
    <div className="rounded-lg bg-background border border-border p-3 rotate-2 w-64 shadow-lg select-none">
      <DealCardBody deal={deal} />
    </div>
  );
}

export default function PipelineBoard({
  opps,
  setOpps,
  reload,
  onOpen,
  quickAddNonce,
  onQuickAddHandled,
}: {
  opps: Deal[];
  setOpps: React.Dispatch<React.SetStateAction<Deal[]>>;
  reload: () => void;
  onOpen: (d: Deal) => void;
  /** Bump to open the quick-add input on the first stage (header "Add Deal"). */
  quickAddNonce?: number;
  /** Called after the quick-add request above is consumed. */
  onQuickAddHandled?: () => void;
}) {
  const { toast, confirm } = useUI();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [addStage, setAddStage] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // The whole card is the drag handle (DEMO look, no grip icon). A real drag
  // can leave a trailing click on the card — this flag swallows it.
  const suppressClick = useRef(false);
  const clearSuppress = () => {
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // External "Add Deal" request: open the quick-add input on the first stage.
  useEffect(() => {
    if (!quickAddNonce) return;
    setAddStage(STAGES[0].id);
    setAddTitle("");
    onQuickAddHandled?.();
  }, [quickAddNonce, onQuickAddHandled]);

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
    suppressClick.current = true;
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

    setDragOverColumn(
      targetStage !== activeDeal.stage ? targetStage : overIsColumn ? targetStage : null
    );

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
    clearSuppress();
    if (!over) {
      // Dropped outside any column — dragOver already moved the card
      // optimistically, so restore server state.
      reload();
      return;
    }

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
    } catch (e) {
      toast.error("Failed to update opportunity stage");
      console.error("Failed to update opportunity stage:", e);
      reload();
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDragOverColumn(null);
    clearSuppress();
    // dragOver moved the card optimistically — restore server state.
    reload();
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
    } catch (e) {
      toast.error("Failed to create opportunity");
      console.error("Failed to create opportunity:", e);
      reload();
    }
  };

  const removeDeal = async (deal: Deal) => {
    const ok = await confirm({
      title: "Delete deal?",
      message: `"${deal.title}" will be permanently removed from the pipeline.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const { crm } = await import("../lib/api");
      await crm.deleteOpportunity(deal.id);
      setOpps((prev) => prev.filter((o) => o.id !== deal.id));
      toast.success("Deal deleted");
    } catch (e) {
      toast.error("Failed to delete deal");
      console.error("Failed to delete deal:", e);
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
      onDragCancel={handleDragCancel}
    >
      {/* Joined kanban board — columns as hairline-divided cells (DEMO look). */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 rounded-xl border border-border bg-card overflow-hidden">
        {STAGES.map((s, i) => {
          const list = byStage[s.id] ?? [];
          const total = list.reduce((a, o) => a + o.value, 0);
          const isOver = dragOverColumn === s.id;
          const last = i === STAGES.length - 1;
          return (
            <div
              key={s.id}
              data-column={s.id}
              className={cn(
                "min-w-0 border-border xl:border-b-0 transition-colors",
                !last && "border-b xl:border-r",
                !last && i % 2 === 0 && "md:border-r",
                last && "md:col-span-2 xl:col-span-1",
                isOver && "bg-hover/60"
              )}
            >
              <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap",
                      s.pill
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {list.length}
                  </span>
                </div>
                <span className="text-[11.5px] text-muted-foreground tabular-nums truncate">
                  {aed(total)}
                </span>
              </div>

              <SortableContext
                items={list.map((o) => o.id)}
                strategy={verticalListSortingStrategy}
                id={s.id}
              >
                <div className="p-3 space-y-2 min-h-[240px]">
                  {list.map((o) => (
                    <SortableDealCard
                      key={o.id}
                      deal={o}
                      onOpen={onOpen}
                      onDelete={removeDeal}
                      suppressClick={suppressClick}
                    />
                  ))}
                  {list.length === 0 && (
                    <p className="py-6 text-center text-[12px] text-muted-foreground/60">
                      Drop deals here
                    </p>
                  )}
                  {addStage === s.id ? (
                    <input
                      autoFocus
                      className="input h-8 w-full text-[13px]"
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
                      type="button"
                      onClick={() => {
                        setAddStage(s.id);
                        setAddTitle("");
                      }}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add deal
                    </button>
                  )}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>

      {opps.length === 0 && (
        <div className="grid place-items-center py-12 text-[13px] text-muted-foreground">
          <Trophy size={20} className="mb-2 text-muted-foreground/50" />
          No opportunities yet.
        </div>
      )}

      <DragOverlay>
        {activeDeal ? <DealCardOverlay deal={activeDeal} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
