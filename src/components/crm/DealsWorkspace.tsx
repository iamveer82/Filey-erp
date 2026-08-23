import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { Opportunity } from "../../lib/api";
import { downloadCsv } from "../../lib/csv";
import {
  deletePipelineView,
  listPipelineViews,
  matchesView,
  savePipelineView,
  type PipelineFilter,
  type PipelineView,
} from "../../lib/pipelineViews";
import { useUI } from "../../lib/ui";
import PipelineBoard from "../PipelineBoard";
import { SearchInput } from "../ui";
import { MenuPopover, MenuItemRow, MenuSep } from "../ui-menu";
import DealList from "./DealList";
import SavedViewChips from "./SavedViewChips";
import ViewSwitcher, { type DealsViewMode } from "./ViewSwitcher";

/** The deals workspace: one toolbar (view switcher + live filters + export)
 *  and a saved-view chips row shared by BOTH layouts — the dense List table
 *  and the drag-and-drop PipelineBoard. Filtering happens here so switching
 *  layouts never loses your place. */
export default function DealsWorkspace({
  opps,
  setOpps,
  reload,
  onOpen,
  quickAddNonce,
  onQuickAddHandled,
}: {
  opps: Opportunity[];
  setOpps: React.Dispatch<React.SetStateAction<Opportunity[]>>;
  reload: () => void;
  onOpen: (deal: Opportunity) => void;
  /** Bump to open the board's quick-add input on the first stage. */
  quickAddNonce?: number;
  onQuickAddHandled?: () => void;
}) {
  const { toast } = useUI();
  const [mode, setMode] = useState<DealsViewMode>("list");
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [views, setViews] = useState<PipelineView[]>([]);
  const ownerBtnRef = useRef<HTMLButtonElement>(null);
  const [ownerOpen, setOwnerOpen] = useState(false);

  // "Add deal" targets the board's first-column quick-add input.
  useEffect(() => {
    if (quickAddNonce) setMode("board");
  }, [quickAddNonce]);

  useEffect(() => setViews(listPipelineViews()), []);

  const owners = useMemo(
    () =>
      [...new Set(opps.map((o) => o.owner).filter((o): o is string => !!o))].sort(),
    [opps]
  );

  const filter: PipelineFilter = {
    query,
    owner: ownerFilter || undefined,
  };
  const visible = useMemo(
    () => opps.filter((o) => matchesView(o, filter)),
    // `filter` is rebuilt each render; its primitive fields are the real inputs.
    [opps, query, ownerFilter] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtersActive = !!(query.trim() || ownerFilter);

  const applyView = (v: PipelineView) => {
    setQuery(v.query ?? "");
    setOwnerFilter(v.owner ?? "");
  };

  const saveCurrentView = (name: string) => {
    try {
      setViews(
        savePipelineView({
          name,
          query,
          owner: ownerFilter || undefined,
          stage: undefined,
        })
      );
      toast.success(`View "${name}" saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** Export what's on screen — filtered deals with their weighted value. */
  const exportDeals = () =>
    downloadCsv(
      "filey-pipeline",
      visible.map((o) => ({
        title: o.title,
        customer: o.customer_name,
        stage: o.stage,
        value: o.value,
        probability: o.probability,
        weighted_value: Math.round(((Number(o.value) || 0) * (o.probability || 0)) / 100),
        expected_close: o.expected_close ?? "",
        close_reason: o.close_reason ?? "",
        closed_at: o.closed_at ?? "",
        owner: o.owner ?? "",
      })),
      [
        { key: "title", label: "Deal" },
        { key: "customer", label: "Customer" },
        { key: "stage", label: "Stage" },
        { key: "value", label: "Value (AED)" },
        { key: "probability", label: "Probability %" },
        { key: "weighted_value", label: "Weighted value (AED)" },
        { key: "expected_close", label: "Expected close" },
        { key: "close_reason", label: "Close reason" },
        { key: "closed_at", label: "Closed at" },
        { key: "owner", label: "Owner" },
      ]
    );

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ViewSwitcher value={mode} onChange={setMode} />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter deals…"
          className="w-52"
        />
        <button
          type="button"
          ref={ownerBtnRef}
          aria-label="Filter by owner"
          aria-expanded={ownerOpen}
          onClick={() => setOwnerOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[13px] text-foreground transition-colors hover:bg-hover"
        >
          <span className="max-w-[140px] truncate">
            {ownerFilter || "All owners"}
          </span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
        <MenuPopover
          open={ownerOpen}
          onClose={() => setOwnerOpen(false)}
          anchorRef={ownerBtnRef}
          align="start"
          closeOnScroll
          className="w-52"
        >
          <MenuItemRow
            label="All owners"
            checked={ownerFilter === ""}
            onClick={() => {
              setOwnerFilter("");
              setOwnerOpen(false);
            }}
          />
          <MenuSep />
          {owners.map((o) => (
            <MenuItemRow
              key={o}
              label={o}
              checked={ownerFilter === o}
              onClick={() => {
                setOwnerFilter(o);
                setOwnerOpen(false);
              }}
            />
          ))}
        </MenuPopover>
        {filtersActive && (
          <button
            type="button"
            className="btn-ghost h-8"
            onClick={() => {
              setQuery("");
              setOwnerFilter("");
            }}
          >
            Clear
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="btn-ghost h-8"
          aria-label="Export pipeline to CSV"
          onClick={exportDeals}
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* Saved views — same chips on both layouts */}
      <div className="mb-3">
        <SavedViewChips
          views={views}
          filter={filter}
          filtersActive={filtersActive}
          onApply={applyView}
          onDelete={(name) => setViews(deletePipelineView(name))}
          onSave={saveCurrentView}
        />
      </div>

      {mode === "list" ? (
        // Filtered-to-zero is announced by the shared message below; the
        // table's own Trophy empty state is for a genuinely empty pipeline.
        visible.length > 0 || !filtersActive ? (
          <DealList opps={visible} onOpen={onOpen} />
        ) : null
      ) : (
        <PipelineBoard
          opps={visible}
          fullOpps={opps}
          setOpps={setOpps}
          reload={reload}
          onOpen={onOpen}
          quickAddNonce={quickAddNonce}
          onQuickAddHandled={onQuickAddHandled}
        />
      )}

      {visible.length === 0 && filtersActive && (
        <div className="grid place-items-center py-12 text-[13px] text-muted-foreground">
          No deals match these filters.
        </div>
      )}
    </div>
  );
}
