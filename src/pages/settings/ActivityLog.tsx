import { errMsg, fmtDate } from "../../lib/format";
import { DataTable, Badge, ErrorBanner } from "../../components/ui";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { tools, AuditEntry } from "../../lib/api";
import { MenuPopover, MenuItemRow } from "../../components/ui-menu";

/* ---------------- Activity Log ---------------- */

/** Toolbar filter dropdown: a quiet button showing the current choice, opening
 *  the shared app menu with a check on it. Replaces the old native selects so
 *  every toolbar dropdown in the app behaves and looks the same. */
function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost"
      >
        {current?.label ?? value}
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>
      <MenuPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        closeOnScroll
        className="w-44"
      >
        {options.map((o) => (
          <MenuItemRow
            key={o.value}
            label={o.label}
            checked={o.value === value}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        ))}
      </MenuPopover>
    </>
  );
}

const ACTION_TONE: Record<string, "success" | "warn" | "danger" | "info"> = {
  insert: "success",
  update: "warn",
  delete: "danger",
};
const prettyEntity = (e: string) =>
  e.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const fmtVal = (x: unknown) =>
  x == null ? "∅" : typeof x === "object" ? JSON.stringify(x) : String(x);

/** Render the log_audit() diff as "field: old → new" pairs (updates only;
 *  create/delete are already conveyed by the Action column). */
function summarizeChanges(changes: AuditEntry["changes"]): string {
  if (!changes || typeof changes !== "object") return "";
  if ("_created" in changes || "_deleted" in changes) return "";
  const parts: string[] = [];
  for (const [field, v] of Object.entries(changes)) {
    if (v && typeof v === "object" && "old" in v && "new" in v) {
      const d = v as { old: unknown; new: unknown };
      parts.push(`${field}: ${fmtVal(d.old)} → ${fmtVal(d.new)}`);
    }
  }
  return parts.join(", ");
}

export default function ActivityLog() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [q, setQ] = useState("");

  const load = () => {
    setLoading(true);
    setError(null);
    tools
      .auditLog(200)
      .then(setAudit)
      .catch((error) => setError(errMsg(error)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  // Refresh explicitly: visited settings tabs stay mounted to preserve drafts.

  const entities = useMemo(
    () => Array.from(new Set(audit.map((a) => a.entity))).sort(),
    [audit]
  );
  const filtered = useMemo(
    () =>
      audit.filter(
        (a) =>
          (action === "all" || a.action === action) &&
          (entity === "all" || a.entity === entity) &&
          (!q.trim() ||
            a.actor.toLowerCase().includes(q.toLowerCase()) ||
            (a.details ?? "").toLowerCase().includes(q.toLowerCase()))
      ),
    [audit, action, entity, q]
  );

  return (
    <SettingsPanel>
      <SettingsSection
        title="Activity log"
        description="Recent changes to your workspace. Filter by person, action or record type."
        stacked
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input flex-1 min-w-[160px]"
            aria-label="Search actor or details"
            placeholder="Search actor or details…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <FilterMenu
            label="Filter by action"
            value={action}
            onChange={setAction}
            options={[
              { value: "all", label: "All actions" },
              { value: "insert", label: "Created" },
              { value: "update", label: "Updated" },
              { value: "delete", label: "Deleted" },
            ]}
          />
          <FilterMenu
            label="Filter by type"
            value={entity}
            onChange={setEntity}
            options={[
              { value: "all", label: "All types" },
              ...entities.map((e) => ({ value: e, label: prettyEntity(e) })),
            ]}
          />
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : error ? "Retry" : "Refresh activity"}
          </button>
        </div>
        {error ? (
          <ErrorBanner message={`Could not load activity: ${error}`} />
        ) : (
          <DataTable<AuditEntry>
            rows={filtered}
            pageSize={10}
            loading={loading}
            empty="No activity recorded yet"
            columns={[
              {
                key: "t",
                label: "When",
                sortValue: (a) => a.created_at ?? "",
                render: (a) => fmtDate(a.created_at),
              },
              {
                key: "actor",
                label: "Actor",
                sortValue: (a) => a.actor,
                render: (a) => <span className="font-medium text-ink">{a.actor}</span>,
              },
              {
                key: "act",
                label: "Action",
                sortValue: (a) => a.action,
                render: (a) => (
                  <Badge tone={ACTION_TONE[a.action] ?? "info"}>
                    {a.action === "insert"
                      ? "created"
                      : a.action === "delete"
                        ? "deleted"
                        : a.action}
                  </Badge>
                ),
              },
              {
                key: "ent",
                label: "Type",
                sortValue: (a) => a.entity,
                render: (a) => prettyEntity(a.entity),
              },
              {
                key: "d",
                label: "Details",
                sortValue: (a) => a.details ?? "",
                render: (a) => a.details ?? "—",
              },
              {
                key: "chg",
                label: "Changes",
                sortValue: () => "",
                render: (a) => {
                  const s = summarizeChanges(a.changes);
                  return s ? (
                    <span
                      className="text-xs text-muted-foreground block max-w-[280px] truncate"
                      title={s}
                    >
                      {s}
                    </span>
                  ) : (
                    "—"
                  );
                },
              },
            ]}
          />
        )}
      </SettingsSection>
    </SettingsPanel>
  );
}

/* ---------------- Security ---------------- */
