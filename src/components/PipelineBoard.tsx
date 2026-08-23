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
import { Eye, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { aed, cn } from "../lib/format";
import { useUI } from "../lib/ui";
import type { Opportunity } from "../lib/api";
import { STAGE_PROB, DEAL_STAGES } from "./crm/stageMeta";
import { MenuPopover, MenuItemRow } from "./ui-menu";

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
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="relative shrink-0 -mt-0.5 -mr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        ref={btnRef}
        aria-label="Deal actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover border border-transparent hover:border-border transition-colors"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      <MenuPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        align="end"
        closeOnScroll
        className="w-40"
      >
        <MenuItemRow
          icon={<Eye size={14} />}
          label="View details"
          onClick={() => {
            setOpen(false);
            onView();
          }}
        />
        <MenuItemRow
          danger
          icon={<Trash2 size={14} />}
          label="Delete"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
        />
      </MenuPopover>
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

/**
 * The kanban board half of the deals workspace. Receives already-filtered
 * deals (`opps`) from DealsWorkspace plus the unfiltered `fullOpps` — reorder
 * and contact-pruning must reason about every deal, not just visible ones.
 */
export default function PipelineBoard({
  opps,
  fullOpps,
  setOpps,
  reload,
  onOpen,
  quickAddNonce,
  onQuickAddHandled,
}: {
  opps: Deal[];
  /** Unfiltered list (defaults to `opps`) used for reorder + prune integrity. */
  fullOpps?: Deal[];
  setOpps: React.Dispatch<React.SetStateAction<Deal[]>>;
  reload: () => void;
  onOpen: (d: Deal) => void;
  /** Bump to open the quick-add input on the first stage (header "Add deal"). */
  quickAddNonce?: number;
  /** Called after the quick-add request above is consumed. */
  onQuickAddHandled?: () => void;
}) {
  const everything = fullOpps ?? opps;
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

  // External "Add deal" request: open the quick-add input on the first stage.
  useEffect(() => {
    if (!quickAddNonce) return;
    setAddStage(DEAL_STAGES[0].id);
    setAddTitle("");
    onQuickAddHandled?.();
  }, [quickAddNonce, onQuickAddHandled]);

  const byStage = useMemo(() => {
    const m: Record<string, Deal[]> = {};
    for (const s of DEAL_STAGES) m[s.id] = [];
    for (const o of opps) (m[o.stage] ??= []).push(o);
    return m;
  }, [opps]);

  const activeDeal = useMemo(
    () => everything.find((o) => o.id === activeId) ?? null,
    [activeId, everything]
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

    const draggedId = Number(active.id);
    const overId = over.id;

    const draggedDeal = everything.find((o) => o.id === draggedId);
    if (!draggedDeal) return;

    const overIsColumn = DEAL_STAGES.some((s) => s.id === overId);
    const overDeal = everything.find((o) => o.id === Number(overId));

    let targetStage = draggedDeal.stage;
    if (overIsColumn) {
      targetStage = String(overId);
    } else if (overDeal) {
      targetStage = overDeal.stage;
    }

    setDragOverColumn(
      targetStage !== draggedDeal.stage ? targetStage : overIsColumn ? targetStage : null
    );

    if (targetStage !== draggedDeal.stage) {
      setOpps((prev) =>
        prev.map((o) =>
          o.id === draggedId
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

    const draggedId = Number(active.id);
    const overId = over.id;

    const draggedDeal = everything.find((o) => o.id === draggedId);
    if (!draggedDeal) return;

    const overDeal = everything.find((o) => o.id === Number(overId));

    if (overDeal && draggedDeal.stage === overDeal.stage) {
      // Reorder against the FULL list so filtered-out deals survive the merge.
      const stageItems = everything.filter((o) => o.stage === draggedDeal.stage);
      const oldIndex = stageItems.findIndex((o) => o.id === draggedId);
      const newIndex = stageItems.findIndex((o) => o.id === Number(overId));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(stageItems, oldIndex, newIndex);
        const otherItems = everything.filter((o) => o.stage !== draggedDeal.stage);
        setOpps([...otherItems, ...reordered]);
      }
    }

    try {
      await import("../lib/api").then((m) =>
        m.crm.setOppStage(draggedId, draggedDeal.stage)
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
      // Roles pointing at a deleted deal would resurface as ghosts. Prune
      // against the FULL list — a role on a merely-filtered-out deal stays.
      import("../lib/dealContacts").then((m) =>
        m.pruneDealContacts(everything.filter((o) => o.id !== deal.id).map((o) => o.id))
      );
      toast.success("Deal deleted");
    } catch (e) {
      toast.error("Failed to delete deal");
      console.error("Failed to delete opportunity:", e);
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
      {/* Joined kanban board - columns as hairline-divided cells (DEMO look). */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 rounded-xl border border-border bg-card overflow-hidden">
        {DEAL_STAGES.map((s, i) => {
          const list = byStage[s.id] ?? [];
          const total = list.reduce((a, o) => a + o.value, 0);
          const isOver = dragOverColumn === s.id;
          const last = i === DEAL_STAGES.length - 1;
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

      <DragOverlay>
        {activeDeal ? <DealCardOverlay deal={activeDeal} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
