import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SlidersHorizontal,
  Cloud,
  HardDrive,
  ChevronRight,
  CalendarDays,
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
import CrmToday from "../components/crm/CrmToday";
import CrmBulkEdit from "../components/crm/CrmBulkEdit";
import { crmDuplicates, crmBulkFields } from "../lib/crmOrganization";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import RecordIdentity, { RecordAvatar } from "../components/crm/RecordIdentity";
import {
  parseRecordStack,
  pushRecord,
  recordKey,
  type RecordRef,
} from "../components/crm/recordStack";
import "./Crm.css";
import {
  crmColumns,
  defaultCrmColumns,
  crmSortValue,
  DUE_FILTERS,
  matchesDueFilter,
  withRelationshipCounts,
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
type View = CrmObject | "overview" | "today" | "reports";
type Editor = { kind: CrmObject; row?: CrmRow; initial?: Record<string, string> };
const DESCRIPTIONS: Record<View, string> = {
  today: "The next steps that keep your business moving.",
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
  duplicates?: string;
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
  const [draftEditor, setDraftEditor] = useState<Editor | null>(null);
  const recordStack = parseRecordStack(params.get("record"));
  const topRecord = recordStack[recordStack.length - 1];
  const selectedRecord =
    topRecord && data[topRecord.kind].find((row) => row.id === topRecord.id);
  const editor: Editor | null =
    draftEditor ||
    (topRecord && selectedRecord ? { kind: topRecord.kind, row: selectedRecord } : null);
  const previousRef = draftEditor ? topRecord : recordStack[recordStack.length - 2];
  const previousRow =
    previousRef && data[previousRef.kind].find((row) => row.id === previousRef.id);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<{ kind: CrmObject; rows: CrmRow[] } | null>(
    null
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
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
  useLiveSync(load, ["crm_customers", "crm_people", "crm_leads", "crm_opportunities", "crm_tasks", "crm_notes", "crm_activities", "app_settings"]);
  const go = (next: View) => {
    setParams({ view: next });
    setDraftEditor(null);
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
  const writeRecordStack = (stack: RecordRef[], replace = true) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (stack.length) next.set("record", stack.map(recordKey).join(","));
        else next.delete("record");
        return next;
      },
      { replace }
    );
  };
  const closeRecord = () => {
    setDraftEditor(null);
    writeRecordStack([]);
  };
  const returnToRecord = () => {
    if (draftEditor) setDraftEditor(null);
    else writeRecordStack(recordStack.slice(0, -1));
  };
  const open = (object: CrmObject, row: CrmRow) => {
    setDraftEditor(null);
    writeRecordStack(
      pushRecord(recordStack, { kind: object, id: row.id }),
      recordStack.length > 0
    );
  };
  const add = (object: CrmObject, initial?: Record<string, string>) =>
    setDraftEditor({ kind: object, initial });
  const rows = useMemo(
    () => (kind ? withRelationshipCounts(kind, data) : []),
    [kind, data]
  );
  const spec = kind ? CRM_OBJECTS[kind] : null;
  const duplicateIds = new Set(
    kind ? crmDuplicates(kind, rows).flatMap((group) => group.ids) : []
  );
  const visible = rows
    .filter(
      (row) =>
        matchesCrmSearch(kind!, row, data, q) &&
        (params.get("duplicates") !== "1" || duplicateIds.has(row.id)) &&
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
        duplicates: params.get("duplicates") || "",
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
  const currentTitle = kind
    ? CRM_OBJECTS[kind].label
    : view === "today"
      ? "Today"
      : "CRM overview";
  const navItems = [
    { id: "overview" as View, title: "Overview", Icon: LayoutDashboard },
    { id: "today" as View, title: "Today", Icon: CalendarDays },
    ...OBJECT_KEYS.map((id) => ({ id, title: CRM_OBJECTS[id].label, Icon: icons[id] })),
  ];

  if (view === "reports")
    return <Navigate to="/reports?tab=insights&section=deals" replace />;

  return (
    <div className="crm-workspace">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-5">
        <span>Filey</span>
        <ChevronRight size={12} />
        <strong className="text-foreground font-medium">CRM</strong>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {isLocalMode() ? <HardDrive size={13} /> : <Cloud size={13} />}
          {isLocalMode() ? "Stored on this device" : "Cloud workspace"}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
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
          className="crm-navigation hidden sm:flex items-center gap-1 overflow-x-auto border-b border-border pb-3"
        >
          {navItems.map(({ id, title, Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={view === id ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-2 px-3 py-2.5 rounded-full text-[13px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  className="btn-ghost w-10 p-0"
                  aria-label="Refresh CRM"
                  title="Refresh CRM"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
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
          {!loading && params.has("record") && (!topRecord || !selectedRecord) && (
            <div
              className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm"
              role="status"
            >
              <span className="flex-1">
                This record is unavailable in the current workspace. It may have been
                removed or belong to another workspace.
              </span>
              <button className="btn-ghost" onClick={closeRecord}>
                Dismiss
              </button>
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
          ) : view === "today" ? (
            <CrmToday
              data={data}
              onOpen={open}
              onAdd={add}
              disabled={loading || !!error}
              onComplete={async (row) => {
                await saveCrmStatus("tasks", row, "done");
                await load();
              }}
            />
          ) : (
            kind &&
            spec && (
              <>
                <div className="crm-toolbar flex flex-wrap items-center gap-2 mb-3">
                  <label className="relative flex-1 min-w-48 max-w-sm">
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
                    title="Save these filters and columns on this device"
                    disabled={!viewStorageKey}
                    onClick={() => void saveView()}
                  >
                    <Bookmark size={14} />
                    Save view
                  </button>
                  {!!duplicateIds.size && (
                    <button
                      className={cn(
                        "btn-ghost",
                        params.get("duplicates") === "1" && "bg-hover"
                      )}
                      aria-pressed={params.get("duplicates") === "1"}
                      onClick={() =>
                        filter("duplicates", params.get("duplicates") === "1" ? "" : "1")
                      }
                    >
                      Possible duplicates · {duplicateIds.size}
                    </button>
                  )}
                  {(kind === "companies" || kind === "contacts") && (
                    <button
                      className="btn-ghost"
                      disabled={loading || !!error}
                      onClick={() => setFieldsOpen(true)}
                    >
                      Custom fields
                    </button>
                  )}
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
                  {(q || status || owner || due || params.get("duplicates")) && (
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        setParams((previous) => {
                          const next = new URLSearchParams(previous);
                          ["q", "status", "owner", "due", "duplicates"].forEach((key) =>
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
                                ["sort", "direction", "columns", "due", "duplicates"]
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
                    className="crm-board flex gap-3 overflow-x-auto pb-4"
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
                            className="crm-board-column w-64 shrink-0 rounded-xl bg-muted/40"
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
                            <div className="px-3 py-3 space-y-2">
                              <div className="flex items-center justify-between text-[13px] font-medium">
                                <span className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "h-2 w-2 rounded-full",
                                      stage === "won" || stage === "done"
                                        ? "bg-success"
                                        : stage === "lost" || stage === "cancelled"
                                          ? "bg-muted-foreground"
                                          : "bg-primary-400"
                                    )}
                                  />
                                  {label(stage)}
                                </span>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {cards.length}
                                </span>
                              </div>
                              {kind === "deals" && (
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  {aed(
                                    cards.reduce(
                                      (sum, row) => sum + (Number(row.value) || 0),
                                      0
                                    )
                                  )}
                                </p>
                              )}
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
                                  className="bg-card border border-border rounded-xl p-3"
                                >
                                  <button
                                    className="text-left w-full font-medium text-sm hover:underline"
                                    onClick={() => open(kind, row)}
                                  >
                                    {recordName(kind, row)}
                                  </button>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                                    <RecordAvatar
                                      kind={kind === "deals" ? "companies" : "contacts"}
                                      name={text(row.customer_name || row.assignee)}
                                    />
                                    <span className="truncate">
                                      {text(row.customer_name || row.assignee) ||
                                        "Unassigned"}
                                    </span>
                                  </div>
                                  {kind === "deals" && (
                                    <div className="font-semibold text-sm mt-3 tabular-nums">
                                      {aed(Number(row.value) || 0)}
                                    </div>
                                  )}
                                  {row.expected_close || row.due_date ? (
                                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <CalendarDays size={13} />
                                      {fmtDate(text(row.expected_close || row.due_date))}
                                    </p>
                                  ) : null}
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
                    bulkActions={
                      crmBulkFields(kind).length && !loading && !error
                        ? [
                            {
                              label: "Update selected",
                              run: (selected) => {
                                setBulkEdit({ kind, rows: selected });
                              },
                            },
                          ]
                        : undefined
                    }
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
                            className="text-left min-w-40 max-w-72 hover:underline"
                            aria-label={recordName(kind, r)}
                            onClick={() => open(kind, r)}
                          >
                            <RecordIdentity kind={kind} row={r} />
                            {duplicateIds.has(r.id) && (
                              <span className="block mt-1 text-[11px] text-muted-foreground">
                                Possible duplicate · review
                              </span>
                            )}
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
                            if (field.type === "count")
                              return (
                                <span className="tabular-nums">
                                  {Number(r[field.key]) || 0}
                                </span>
                              );
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
          onClose={closeRecord}
          onBack={previousRow ? returnToRecord : undefined}
          backLabel={
            previousRef && previousRow
              ? recordName(previousRef.kind, previousRow)
              : undefined
          }
          onOpen={open}
          onAdd={add}
          mutationDisabled={loading || !!error}
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
            const dealId = await convertCrmLead(editor.row.id);
            if (!active.current) return;
            setDraftEditor(null);
            toast.success("Lead converted to a company, contact and deal");
            await load();
            if (!active.current) return;
            setParams({ view: "deals", record: `deals:${dealId}` });
          }}
        />
      )}
      {bulkEdit && (
        <CrmBulkEdit
          kind={bulkEdit.kind}
          rows={bulkEdit.rows}
          data={data}
          onClose={() => setBulkEdit(null)}
          onSaved={load}
        />
      )}
      {(kind === "companies" || kind === "contacts") && (
        <CustomFieldsManager
          open={fieldsOpen}
          onOpenChange={setFieldsOpen}
          module={kind === "companies" ? "customers" : "contacts"}
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
