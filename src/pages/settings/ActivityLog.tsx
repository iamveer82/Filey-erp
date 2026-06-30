import { useLiveSync } from "../../lib/realtime";
import { fmtDate } from "../../lib/format";
import { DataTable, Badge } from "../../components/ui";
import { useEffect, useMemo, useState } from "react";
import { tools, AuditEntry } from "../../lib/api";

/* ---------------- Activity Log ---------------- */

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
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [q, setQ] = useState("");

  const load = () => {
    tools
      .auditLog()
      .then(setAudit)
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useLiveSync(load);

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
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[160px]"
          placeholder="Search actor or details…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="select !w-auto"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="all">All actions</option>
          <option value="insert">Created</option>
          <option value="update">Updated</option>
          <option value="delete">Deleted</option>
        </select>
        <select
          className="select !w-auto"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <option value="all">All types</option>
          {entities.map((e) => (
            <option key={e} value={e}>
              {prettyEntity(e)}
            </option>
          ))}
        </select>
      </div>
      <DataTable<AuditEntry>
        rows={filtered}
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
                  className="text-xs text-muted block max-w-[280px] truncate"
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
    </div>
  );
}

/* ---------------- Security ---------------- */
