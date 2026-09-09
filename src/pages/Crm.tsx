import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  Building2,
  CheckSquare,
  Download,
  LayoutDashboard,
  List,
  Kanban,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Target,
  Users,
  Upload,
  Bookmark,
  BarChart3,
  SlidersHorizontal,
} from "lucide-react";
import {
  CRM_OBJECTS,
  OBJECT_KEYS,
  STAGES,
  TASK_STATUSES,
  emptyCrmData,
  loadCrmData,
  saveCrmRecord,
  saveCrmStatus,
  deleteCrmRecord,
  recordName,
  recordDraft,
  validateCrmDraft,
  convertCrmLead,
  linkedName,
  objectForTarget,
  matchesCrmSearch,
  crmExportRows,
  text,
  label,
  tasksCalendar,
  type CrmData,
  type CrmObject,
  type CrmRow,
} from "../lib/crmWorkspace";
import { getCacheScope, importCrmRecords } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, cn, fmtDate, todayYmd, errMsg } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { getDataMode, isLocalMode } from "../lib/dataMode";
import { downloadText } from "../lib/localPaths";
import { PageHeader, DataTable, ErrorBanner, Badge, Spinner } from "../components/ui";
import ImportCsvModal from "../components/ImportCsvModal";
import RecordEditor from "../components/crm/RecordEditor";
import CrmOverview from "../components/crm/CrmOverview";
import {
  crmColumns,
  defaultCrmColumns,
  crmSortValue,
  DUE_FILTERS,
  matchesDueFilter,
} from "../components/crm/viewOptions";

const icons = {
  companies: Building2,
  contacts: Users,
  leads: Target,
  deals: Kanban,
  tasks: CheckSquare,
  notes: StickyNote,
  activities: Activity,
};
type View = CrmObject | "overview" | "reports";
type Editor = { kind: CrmObject; row?: CrmRow; initial?: Record<string, string> };
const DESCRIPTIONS: Record<View, string> = {
  overview: "Your relationships, pipeline, and next steps in one place.",
  companies: "Accounts connected to their people, deals, and history.",
  contacts: "The people behind every business relationship.",
  leads: "Capture interest, qualify it, and turn it into an opportunity.",
  deals: "Track opportunities from qualification to won or lost.",
  tasks: "Assign the next step and keep commitments on schedule.",
  notes: "Keep context attached to the record it belongs to.",
  activities: "Calls, meetings, messages, and follow-ups in one timeline.",
  reports: "Pipeline values and forecast assumptions, explained.",
};
function workspaceViewKey(userId?: string): string | null {
  const mode = getDataMode();
  const scope = getCacheScope();
  if (!mode || !userId || !scope?.endsWith(`:user:${userId}`)) return null;
  // The old anonymous v1 key has no provable owner. Preserve it without exposing it.
  return `filey.crm.workspace.views.v2:${encodeURIComponent(JSON.stringify([mode, scope]))}`;
}
type SavedView = {
  name: string;
  view: string;
  q: string;
  status: string;
  owner: string;
  mode: string;
  sort?: string;
  direction?: string;
  columns?: string;
  due?: string;
};
function readViews(viewStorageKey: string | null): SavedView[] {
  if (!viewStorageKey) return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(viewStorageKey) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (v): v is SavedView =>
            v &&
            ["name", "view", "q", "status", "owner", "mode"].every(
              (key) => typeof v[key] === "string"
            )
        )
      : [];
  } catch {
    return [];
  }
}

export default function Crm() {
  const { user } = useAuth();
  const viewStorageKey = workspaceViewKey(user?.id);
  return (
    <CrmWorkspace
      key={viewStorageKey || "signed-out"}
      viewStorageKey={viewStorageKey}
      userId={user?.id}
    />
  );
}

function CrmWorkspace({
  viewStorageKey,
  userId,
}: {
  viewStorageKey: string | null;
  userId?: string;
}) {
  const { toast, confirm, prompt } = useUI();
  const [params, setParams] = useSearchParams();
  const requested = params.get("view") || "overview";
  const view: View = Object.prototype.hasOwnProperty.call(DESCRIPTIONS, requested)
    ? (requested as View)
    : "overview";
  const kind = OBJECT_KEYS.includes(view as CrmObject) ? (view as CrmObject) : null;
  const [data, setData] = useState<CrmData>(emptyCrmData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorHistory, setEditorHistory] = useState<Editor[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const [views, setViews] = useState(() => readViews(viewStorageKey));
  const active = useRef(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    try {
      const rows = await loadCrmData();
      if (version === generation.current) {
        setData(rows);
        setError("");
      }
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      // Invalidate all current refreshes, including ones issued after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load]);
  useLiveSync(load);
  const go = (next: View) => {
    setParams({ view: next });
    setEditor(null);
    setEditorHistory([]);
    setOptionsOpen(false);
  };
  const filter = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  const q = params.get("q") || "",
    status = params.get("status") || "",
    owner = params.get("owner") || "",
    mode = params.get("mode") || "list",
    due = kind === "tasks" ? params.get("due") || "" : "";
  const availableColumns = kind ? crmColumns(kind) : [];
  const selectedColumns = kind
    ? params.has("columns")
      ? (params.get("columns") || "")
          .split(",")
          .filter((key) => availableColumns.some((field) => field.key === key))
      : defaultCrmColumns(kind)
    : [];
  const sortKey = params.get("sort") || "";
  const sort =
    sortKey && (sortKey === "record" || selectedColumns.includes(sortKey))
      ? { key: sortKey, dir: (params.get("direction") === "desc" ? -1 : 1) as 1 | -1 }
      : null;
  const changeSort = (next: { key: string; dir: 1 | -1 } | null) => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        if (next) {
          updated.set("sort", next.key);
          updated.set("direction", next.dir === 1 ? "asc" : "desc");
        } else {
          updated.delete("sort");
          updated.delete("direction");
        }
        return updated;
      },
      { replace: true }
    );
  };
  const returnToRecord = () => {
    const previous = editorHistory[editorHistory.length - 1];
    setEditor(previous || null);
    setEditorHistory((history) => history.slice(0, -1));
  };
  const followRecord = (next: Editor) => {
    if (editor?.row) setEditorHistory((history) => [...history, editor]);
    setEditor(next);
  };
  const open = (object: CrmObject, row: CrmRow) => setEditor({ kind: object, row });
  const add = (object: CrmObject, initial?: Record<string, string>) =>
    setEditor({ kind: object, initial });
  const rows = kind ? data[kind] : [];
  const spec = kind ? CRM_OBJECTS[kind] : null;
  const visible = rows
    .filter(
      (row) =>
        matchesCrmSearch(kind!, row, data, q) &&
        (!status || text(row[spec!.group]) === status) &&
        (!owner || text(row.owner || row.assignee || row.author) === owner) &&
        matchesDueFilter(row, due, todayYmd())
    )
    .sort((a, b) => {
      if (sort && kind) {
        const av = crmSortValue(kind, a, sort.key, data);
        const bv = crmSortValue(kind, b, sort.key, data);
        if (av !== bv) return (av < bv ? -1 : 1) * sort.dir;
      }
      if (kind === "notes" && Boolean(a.pinned) !== Boolean(b.pinned))
        return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (kind === "tasks") {
        const closed =
          Number(["done", "cancelled"].includes(text(a.status))) -
          Number(["done", "cancelled"].includes(text(b.status)));
        if (closed) return closed;
        const due = (text(a.due_date) || "9999").localeCompare(
          text(b.due_date) || "9999"
        );
        if (due) return due;
      }
      return text(b.created_at).localeCompare(text(a.created_at)) || b.id - a.id;
    });
  const groups = spec
    ? [
        ...new Set([...rows.map((r) => text(r[spec.group])), status].filter(Boolean)),
      ].sort()
    : [];
  const owners = [
    ...new Set(
      [...rows.map((r) => text(r.owner || r.assignee || r.author)), owner].filter(Boolean)
    ),
  ].sort();
  const exportRows = async () => {
    if (!kind) return;
    try {
      await downloadCsv(`filey-${kind}`, crmExportRows(kind, visible));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const saveView = async () => {
    if (!viewStorageKey) return;
    const name = await prompt({
      title: "Save this view",
      label: "View name",
      placeholder: "e.g. Qualified leads",
    });
    if (!name?.trim() || !active.current || workspaceViewKey(userId) !== viewStorageKey)
      return;
    const next = [
      ...views.filter((v) => !(v.view === view && v.name === name.trim())),
      {
        name: name.trim(),
        view,
        q,
        status,
        owner,
        mode,
        sort: sort?.key || "",
        direction: sort?.dir === -1 ? "desc" : "asc",
        columns: selectedColumns.join(","),
        due,
      },
    ];
    try {
      localStorage.setItem(viewStorageKey, JSON.stringify(next));
      setViews(next);
    } catch {
      toast.error("Could not save the view on this device.");
    }
  };
  const changeStatus = async (row: CrmRow, value: string) => {
    if ((kind !== "deals" && kind !== "tasks") || moving.current || loading || error)
      return;
    moving.current = true;
    setBusy(true);
    try {
      await saveCrmStatus(kind, row, value);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      moving.current = false;
      setBusy(false);
    }
  };
  const currentTitle = kind ? CRM_OBJECTS[kind].label : "CRM overview";
  const navItems = [
    { id: "overview" as View, title: "Overview", Icon: LayoutDashboard },
    ...OBJECT_KEYS.map((id) => ({ id, title: CRM_OBJECTS[id].label, Icon: icons[id] })),
    { id: "reports" as View, title: "Reports", Icon: BarChart3 },
  ];

  if (view === "reports")
    return <Navigate to="/reports?tab=insights&section=deals" replace />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-4">
        <Building2 size={14} />
        <span>
          Filey / <strong className="text-foreground font-medium">CRM workspace</strong>
        </span>
        <span className="ml-auto">
          {isLocalMode() ? "Stored on this device" : "Cloud workspace"} · Core CRM is free
        </span>
      </div>
      <div className="flex flex-col xl:flex-row gap-5">
        <label className="sm:hidden text-sm font-medium">
          CRM section
          <select
            aria-label="CRM section"
            className="select w-full mt-2"
            value={view}
            onChange={(e) => go(e.target.value as View)}
          >
            {navItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <nav
          aria-label="CRM sections"
          className="xl:w-40 xl:shrink-0 hidden sm:flex xl:flex-col gap-1 overflow-x-auto xl:overflow-visible pb-2 xl:pb-0"
        >
          {navItems.map(({ id, title, Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={view === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-full text-[13px] whitespace-nowrap",
                view === id
                  ? "bg-hover text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-hover"
              )}
            >
              <Icon size={15} />
              {title}
              {OBJECT_KEYS.includes(id as CrmObject) && (
                <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                  {loading || error ? "—" : data[id as CrmObject].length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={currentTitle}
            subtitle={DESCRIPTIONS[view]}
            action={
              <div className="flex gap-2 flex-wrap">
                <button
                  className="btn-ghost"
                  aria-label="Refresh CRM"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
                {kind && (
                  <button
                    className="btn-primary"
                    disabled={loading || !!error}
                    onClick={() => add(kind)}
                  >
                    <Plus size={15} />
                    New {CRM_OBJECTS[kind].singular}
                  </button>
                )}
                {view === "overview" && (
                  <button
                    className="btn-primary"
                    disabled={loading || !!error}
                    onClick={() => add("leads")}
                  >
                    <Plus size={15} />
                    New lead
                  </button>
                )}
              </div>
            }
          />
          {error && (
            <div className="mb-4">
              <ErrorBanner
                message={`CRM could not refresh: ${error}. Use Refresh to retry.`}
              />
            </div>
          )}
          {loading && !OBJECT_KEYS.some((k) => data[k].length) ? (
            <Spinner label="Loading your CRM workspace…" />
          ) : error && !OBJECT_KEYS.some((k) => data[k].length) ? (
            <p className="py-8 text-sm text-muted-foreground">
              Your records will appear after CRM refreshes successfully.
            </p>
          ) : view === "overview" ? (
            <CrmOverview data={data} onOpen={open} go={go} error={!!error} />
          ) : (
            kind &&
            spec && (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <label className="relative flex-1 min-w-48 max-w-md">
                    <span className="sr-only">Search {spec.label.toLowerCase()}</span>
                    <Search
                      size={15}
                      className="absolute top-3 left-3 text-muted-foreground"
                    />
                    <input
                      className="input pl-9"
                      placeholder={`Search ${spec.label.toLowerCase()}…`}
                      value={q}
                      onChange={(e) => filter("q", e.target.value)}
                    />
                  </label>
                  <select
                    aria-label={`Filter ${label(spec.group)}`}
                    className="select w-auto max-w-48"
                    value={status}
                    onChange={(e) => filter("status", e.target.value)}
                  >
                    <option value="">{label(spec.group)}: all</option>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {label(g)}
                      </option>
                    ))}
                  </select>
                  {owners.length > 0 && spec.group !== "owner" && (
                    <select
                      aria-label="Filter owner"
                      className="select w-auto max-w-44"
                      value={owner}
                      onChange={(e) => filter("owner", e.target.value)}
                    >
                      <option value="">All owners</option>
                      {owners.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  )}
                  {(kind === "deals" || kind === "tasks") && (
                    <div className="inline-flex items-center gap-2">
                      <button
                        aria-label="List view"
                        aria-pressed={mode !== "board"}
                        className={cn(
                          "btn-ghost w-10 p-0 text-muted-foreground hover:text-foreground",
                          mode !== "board" && "bg-hover text-foreground"
                        )}
                        onClick={() => filter("mode", "list")}
                      >
                        <List size={16} />
                      </button>
                      <button
                        aria-label="Board view"
                        aria-pressed={mode === "board"}
                        className={cn(
                          "btn-ghost w-10 p-0 text-muted-foreground hover:text-foreground",
                          mode === "board" && "bg-hover text-foreground"
                        )}
                        onClick={() => filter("mode", "board")}
                      >
                        <Kanban size={16} />
                      </button>
                    </div>
                  )}
                  <button
                    className="btn-ghost"
                    disabled={!viewStorageKey}
                    onClick={() => void saveView()}
                  >
                    <Bookmark size={14} />
                    Save view
                  </button>
                  <button
                    className="btn-ghost"
                    aria-expanded={optionsOpen}
                    aria-controls="crm-view-options"
                    onClick={() => setOptionsOpen((open) => !open)}
                  >
                    <SlidersHorizontal size={14} /> View options
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => void exportRows()}
                    disabled={!visible.length}
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={loading || !!error}
                    onClick={() => setImporting(true)}
                  >
                    <Upload size={14} />
                    Import
                  </button>
                  {kind === "tasks" && (
                    <button
                      className="btn-ghost"
                      disabled={
                        !visible.some(
                          (r) =>
                            r.due_date && !["done", "cancelled"].includes(text(r.status))
                        )
                      }
                      onClick={async () => {
                        try {
                          await downloadText(
                            "filey-tasks.ics",
                            tasksCalendar(visible),
                            "text/calendar;charset=utf-8"
                          );
                        } catch (e) {
                          toast.error(String(e));
                        }
                      }}
                    >
                      Export calendar
                    </button>
                  )}
                </div>
                {optionsOpen && (
                  <section
                    id="crm-view-options"
                    aria-label="View options"
                    className="border border-border rounded-lg bg-card p-4 mb-4 space-y-4"
                  >
                    <div className="flex flex-wrap gap-4">
                      <label className="text-sm flex-1 min-w-40">
                        <span className="label">Sort by</span>
                        <select
                          className="select"
                          value={sort?.key || ""}
                          onChange={(e) =>
                            changeSort(
                              e.target.value
                                ? { key: e.target.value, dir: sort?.dir || 1 }
                                : null
                            )
                          }
                        >
                          <option value="">Default order</option>
                          <option value="record">
                            {kind === "notes" ? "Note" : "Name"}
                          </option>
                          {availableColumns
                            .filter((field) => selectedColumns.includes(field.key))
                            .map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="text-sm flex-1 min-w-40">
                        <span className="label">Sort direction</span>
                        <select
                          className="select"
                          disabled={!sort}
                          value={sort?.dir === -1 ? "desc" : "asc"}
                          onChange={(e) =>
                            sort &&
                            changeSort({
                              key: sort.key,
                              dir: e.target.value === "desc" ? -1 : 1,
                            })
                          }
                        >
                          <option value="asc">Ascending</option>
                          <option value="desc">Descending</option>
                        </select>
                      </label>
                      {kind === "tasks" && (
                        <label className="text-sm flex-1 min-w-48">
                          <span className="label">Task due date</span>
                          <select
                            className="select"
                            value={due}
                            onChange={(e) => filter("due", e.target.value)}
                          >
                            {DUE_FILTERS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <fieldset>
                      <legend className="text-sm font-medium mb-1">Table columns</legend>
                      <p className="text-xs text-muted-foreground mb-2">
                        The record name is always shown. Save the view to keep these
                        choices on this device.
                      </p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        {availableColumns.map((field) => (
                          <label
                            key={field.key}
                            className="inline-flex items-center gap-2 text-sm min-h-10"
                          >
                            <input
                              type="checkbox"
                              checked={selectedColumns.includes(field.key)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...selectedColumns, field.key]
                                  : selectedColumns.filter((key) => key !== field.key);
                                setParams(
                                  (previous) => {
                                    const updated = new URLSearchParams(previous);
                                    updated.set("columns", next.join(","));
                                    if (sort?.key === field.key && !e.target.checked) {
                                      updated.delete("sort");
                                      updated.delete("direction");
                                    }
                                    return updated;
                                  },
                                  { replace: true }
                                );
                              }}
                            />{" "}
                            {field.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </section>
                )}
                <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-muted-foreground">
                  <span>
                    {visible.length} of {rows.length} records
                  </span>
                  {due && (
                    <span>
                      {DUE_FILTERS.find((item) => item.value === due)?.label} · incomplete
                      tasks
                    </span>
                  )}
                  {sort && (
                    <span>
                      Sorted by{" "}
                      {sort.key === "record"
                        ? "name"
                        : availableColumns
                            .find((field) => field.key === sort.key)
                            ?.label.toLowerCase()}{" "}
                      · {sort.dir === 1 ? "ascending" : "descending"}
                    </span>
                  )}
                  {(q || status || owner || due) && (
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        setParams((previous) => {
                          const next = new URLSearchParams(previous);
                          ["q", "status", "owner", "due"].forEach((key) =>
                            next.delete(key)
                          );
                          return next;
                        })
                      }
                    >
                      Clear filters
                    </button>
                  )}
                  {views
                    .filter((v) => v.view === view)
                    .map((v) => (
                      <span
                        key={v.name}
                        className="inline-flex items-center border border-border rounded-full overflow-hidden"
                      >
                        <button
                          className="min-h-10 px-3 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() =>
                            setParams({
                              view,
                              q: v.q,
                              status: v.status,
                              owner: v.owner,
                              mode: v.mode,
                              ...Object.fromEntries(
                                ["sort", "direction", "columns", "due"]
                                  .filter(
                                    (key) => typeof v[key as keyof SavedView] === "string"
                                  )
                                  .map((key) => [
                                    key,
                                    v[key as keyof SavedView] as string,
                                  ])
                              ),
                            })
                          }
                        >
                          {v.name}
                        </button>
                        <button
                          aria-label={`Remove saved view ${v.name}`}
                          className="min-h-10 px-3 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() => {
                            if (
                              !viewStorageKey ||
                              workspaceViewKey(userId) !== viewStorageKey
                            )
                              return;
                            const next = views.filter((r) => r !== v);
                            try {
                              localStorage.setItem(viewStorageKey, JSON.stringify(next));
                              setViews(next);
                            } catch {
                              toast.error("Could not remove saved view.");
                            }
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
                {mode === "board" && (kind === "deals" || kind === "tasks") ? (
                  <div
                    className="flex gap-3 overflow-x-auto pb-4"
                    aria-label={`${spec.label} board`}
                  >
                    {(kind === "deals" ? STAGES : TASK_STATUSES)
                      .concat(
                        groups.filter(
                          (g) => !(kind === "deals" ? STAGES : TASK_STATUSES).includes(g)
                        )
                      )
                      .map((stage) => {
                        const cards = visible.filter(
                          (r) =>
                            (text(r[spec.group]) ||
                              (kind === "tasks" ? "open" : "qualification")) === stage
                        );
                        return (
                          <section
                            key={stage}
                            className="w-64 shrink-0 bg-muted/30 border border-border rounded-lg"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const [sourceKind, id] = e.dataTransfer
                                .getData("application/x-filey-crm")
                                .split(":");
                              const row =
                                sourceKind === kind &&
                                visible.find((r) => r.id === Number(id));
                              if (row) void changeStatus(row, stage);
                            }}
                          >
                            <div className="px-3 py-3 border-b border-border flex justify-between text-sm font-medium">
                              <span>{label(stage)}</span>
                              <span className="text-muted-foreground">
                                {cards.length}
                              </span>
                            </div>
                            <div className="p-2 space-y-2 min-h-32">
                              {cards.map((row) => (
                                <article
                                  key={row.id}
                                  draggable={!busy && !loading && !error}
                                  onDragStart={(e) =>
                                    e.dataTransfer.setData(
                                      "application/x-filey-crm",
                                      `${kind}:${row.id}`
                                    )
                                  }
                                  className="bg-card border border-border rounded-md p-3"
                                >
                                  <button
                                    className="text-left w-full font-medium text-sm hover:underline"
                                    onClick={() => open(kind, row)}
                                  >
                                    {recordName(kind, row)}
                                  </button>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {text(row.customer_name || row.assignee) ||
                                      "Unassigned"}
                                  </div>
                                  {kind === "deals" && (
                                    <div className="font-semibold text-sm mt-3 tabular-nums">
                                      {aed(Number(row.value) || 0)}
                                    </div>
                                  )}
                                  <select
                                    className="select mt-3 text-xs"
                                    aria-label={`Move ${recordName(kind, row)}`}
                                    value={text(row[spec.group]) || stage}
                                    disabled={busy || loading || !!error}
                                    onChange={(e) =>
                                      void changeStatus(row, e.target.value)
                                    }
                                  >
                                    {(kind === "deals" ? STAGES : TASK_STATUSES)
                                      .concat(
                                        groups.filter(
                                          (g) =>
                                            !(
                                              kind === "deals" ? STAGES : TASK_STATUSES
                                            ).includes(g)
                                        )
                                      )
                                      .map((s) => (
                                        <option key={s} value={s}>
                                          {label(s)}
                                        </option>
                                      ))}
                                  </select>
                                </article>
                              ))}
                              {!cards.length && (
                                <p className="px-1 py-4 text-xs text-muted-foreground">
                                  No {spec.label.toLowerCase()} here.
                                </p>
                              )}
                              <button
                                className="btn-ghost w-full"
                                disabled={!!error || loading}
                                onClick={() => add(kind, { [spec.group]: stage })}
                              >
                                <Plus size={13} />
                                Add {spec.singular}
                              </button>
                            </div>
                          </section>
                        );
                      })}
                  </div>
                ) : (
                  <DataTable<CrmRow>
                    key={kind}
                    rows={visible}
                    sort={sort}
                    onSortChange={changeSort}
                    rowKey={(r) => r.id}
                    pageSize={25}
                    loading={loading}
                    onRowClick={(r) => open(kind, r)}
                    empty={
                      rows.length
                        ? "No records match these filters. Clear filters to see all records."
                        : `No ${spec.label.toLowerCase()} yet. Create your first ${spec.singular} or import a CSV.`
                    }
                    columns={[
                      {
                        key: "record",
                        label: kind === "notes" ? "Note" : "Name",
                        sortValue: (r) => recordName(kind, r).toLowerCase(),
                        render: (r) => (
                          <button
                            className="text-left font-medium max-w-72 truncate block hover:underline"
                            onClick={() => open(kind, r)}
                          >
                            {r.pinned ? "★ " : ""}
                            {recordName(kind, r)}
                          </button>
                        ),
                      },
                      ...availableColumns
                        .filter((field) => selectedColumns.includes(field.key))
                        .map((field) => ({
                          key: field.key,
                          label: field.label.replace(" (international format)", ""),
                          sortValue: (r: CrmRow) =>
                            crmSortValue(kind, r, field.key, data),
                          render: (r: CrmRow) => {
                            if (field.type === "company" || field.type === "contact") {
                              const object =
                                field.type === "company" ? "companies" : "contacts";
                              const linked = data[object].find(
                                (c) => c.id === Number(r[field.key])
                              );
                              return linked ? (
                                <button
                                  className="hover:underline text-muted-foreground"
                                  onClick={() => open(object, linked)}
                                >
                                  {recordName(object, linked)}
                                </button>
                              ) : (
                                "—"
                              );
                            }
                            if (field.type === "target") {
                              const object = objectForTarget(r.target_type);
                              const linked =
                                object &&
                                data[object].find(
                                  (row) => row.id === Number(r.target_id)
                                );
                              return object && linked ? (
                                <button
                                  className="hover:underline text-muted-foreground"
                                  onClick={() => open(object, linked)}
                                >
                                  {linkedName(r, data)}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">
                                  {linkedName(r, data)}
                                </span>
                              );
                            }
                            if (field.type === "number")
                              return field.key === "probability"
                                ? `${Number(r[field.key]) || 0}%`
                                : aed(Number(r[field.key]) || 0);
                            if (field.type === "checkbox")
                              return r[field.key] ? "Yes" : "No";
                            if (field.type === "date")
                              return (
                                <span
                                  className={
                                    kind === "tasks" &&
                                    !["done", "cancelled"].includes(text(r.status)) &&
                                    r.due_date &&
                                    text(r.due_date) < todayYmd()
                                      ? "text-danger"
                                      : ""
                                  }
                                >
                                  {fmtDate(text(r[field.key]))}
                                </span>
                              );
                            if (field.type === "select")
                              return (
                                <Badge
                                  tone={
                                    r[field.key] === "won" || r[field.key] === "done"
                                      ? "success"
                                      : "neutral"
                                  }
                                >
                                  {label(r[field.key]) || "—"}
                                </Badge>
                              );
                            return (
                              <span className="block max-w-56 truncate text-muted-foreground">
                                {text(r[field.key]) || "—"}
                              </span>
                            );
                          },
                        })),
                      ...(kind === "tasks"
                        ? [
                            {
                              key: "task-action",
                              label: "Action",
                              render: (row: CrmRow) => (
                                <button
                                  className="btn-ghost whitespace-nowrap"
                                  disabled={busy || loading || !!error}
                                  aria-label={`${["done", "cancelled"].includes(text(row.status)) ? "Reopen" : "Complete"} ${recordName("tasks", row)}`}
                                  onClick={() =>
                                    void changeStatus(
                                      row,
                                      ["done", "cancelled"].includes(text(row.status))
                                        ? "open"
                                        : "done"
                                    )
                                  }
                                >
                                  {["done", "cancelled"].includes(text(row.status))
                                    ? "Reopen"
                                    : "Mark done"}
                                </button>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </>
            )
          )}
        </div>
      </div>
      {editor && (
        <RecordEditor
          key={`${editor.kind}:${editor.row?.id || "new"}:${JSON.stringify(editor.initial)}`}
          {...editor}
          row={
            editor.row
              ? data[editor.kind].find((row) => row.id === editor.row!.id) || editor.row
              : undefined
          }
          data={data}
          onClose={() => {
            setEditor(null);
            setEditorHistory([]);
          }}
          onBack={editorHistory.length ? returnToRecord : undefined}
          backLabel={
            editorHistory.length
              ? recordName(
                  editorHistory[editorHistory.length - 1].kind,
                  editorHistory[editorHistory.length - 1].row!
                )
              : undefined
          }
          onOpen={(kind, row) => followRecord({ kind, row })}
          onAdd={(kind, initial) => followRecord({ kind, initial })}
          onSave={async (draft) => {
            await saveCrmRecord(editor.kind, draft, data, editor.row);
            returnToRecord();
            toast.success("Record saved");
            await load();
          }}
          onDelete={async () => {
            if (
              !editor.row ||
              !(await confirm({
                title: `Delete ${CRM_OBJECTS[editor.kind].singular}?`,
                message:
                  "This permanently removes this record. Linked records must be reassigned first.",
                danger: true,
                confirmLabel: "Delete",
              }))
            )
              return;
            await deleteCrmRecord(editor.kind, editor.row, data);
            returnToRecord();
            toast.success("Record deleted");
            await load();
          }}
          onConvert={async () => {
            if (!editor.row) return;
            await convertCrmLead(editor.row.id);
            setEditor(null);
            toast.success("Lead converted to a company, contact and deal");
            await load();
            go("deals");
          }}
        />
      )}
      {kind && (
        <ImportCsvModal
          open={importing}
          onClose={() => setImporting(false)}
          title={`Import ${CRM_OBJECTS[kind].label.toLowerCase()} · up to 500 rows`}
          fields={CRM_OBJECTS[kind].fields.map((f) => ({
            key: f.key,
            label:
              f.type === "company" || f.type === "contact"
                ? `${f.label} ID`
                : f.type === "target"
                  ? "Related record (e.g. company:12)"
                  : f.label,
            required: f.required,
          }))}
          onImport={async (input) => {
            const patches = input.map((r, index) => {
              const draft = {
                ...recordDraft(kind),
                ...Object.fromEntries(
                  Object.entries(r)
                    .filter(([, v]) => text(v).trim())
                    .map(([k, v]) => [k, text(v)])
                ),
              };
              try {
                return validateCrmDraft(kind, draft, data);
              } catch (e) {
                throw new Error(
                  `Row ${index + 2}: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            });
            await importCrmRecords(CRM_OBJECTS[kind].table, patches);
            await load();
          }}
        />
      )}
    </div>
  );
}
