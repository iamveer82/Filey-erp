import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Plus } from "lucide-react";
import { billing, type InvoiceDocSummary } from "../../lib/api";
import { agentStorageScope, requireAgentStorageScope } from "../../lib/agentStorage";
import {
  text,
  targetKey,
  targetTypes,
  type CrmData,
  type CrmObject,
  type CrmRow,
} from "../../lib/crmWorkspace";
import { cn, errMsg, fmtDate, todayYmd, money } from "../../lib/format";
import { Badge, ErrorBanner } from "../ui";
import { todayQueue } from "./todayQueue";

export default function CrmToday({
  data,
  onOpen,
  onAdd,
  onComplete,
  disabled,
}: {
  data: CrmData;
  onOpen: (kind: CrmObject, row: CrmRow) => void;
  onAdd: (kind: CrmObject, initial?: Record<string, string>) => void;
  onComplete: (row: CrmRow) => Promise<void>;
  disabled: boolean;
}) {
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(30),
    [busy, setBusy] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const completing = useRef(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    let active = true;
    const scope = agentStorageScope();
    setLoading(true);
    setError("");
    void billing
      .listDocs()
      .then((rows) => {
        requireAgentStorageScope(scope ?? "signed-out");
        if (active) setInvoices(rows);
      })
      .catch((e) => {
        if (active) { setInvoices([]); setError(errMsg(e)); }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data, attempt]);
  const today = todayYmd(),
    queue = todayQueue(data, invoices, today),
    visible = queue.filter((item) => filter === "all" || item.bucket === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Follow-up period">
          {[
            ["all", "All next steps"],
            ["overdue", "Overdue"],
            ["today", "Today"],
            ["upcoming", "Coming up"],
            ["unscheduled", "Needs a date"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={cn("btn-ghost", filter === value && "bg-hover")}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setLimit(30);
              }}
            >
              {label}
              <span className="text-muted-foreground text-xs">
                {value === "all"
                  ? queue.length
                  : queue.filter((item) => item.bucket === value).length}
              </span>
            </button>
          ))}
        </div>
        <button
          className="btn-primary"
          disabled={disabled}
          onClick={() => onAdd("tasks", { due_date: today })}
        >
          <Plus size={14} />
          Add task
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tasks, meetings, leads without recorded activity, and invoice balances. Dates use
        your device's calendar.
      </p>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Refreshing invoice balances…
        </p>
      )}
      {error && (
        <>
          <ErrorBanner message={`Invoice follow-ups could not refresh: ${error}`} />
          <button className="btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
            Retry invoices
          </button>
        </>
      )}
      {actionError && <ErrorBanner message={actionError} />}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {!visible.length && (
          <p className="p-6 text-sm text-muted-foreground">No next steps in this view.</p>
        )}
        {visible.slice(0, limit).map((item) => (
          <div
            key={`${item.kind}:${item.row.id}`}
            className="flex flex-wrap items-center gap-3 p-4"
          >
            <div className="min-w-40 flex-1">
              {item.kind === "invoices" ? (
                <Link
                  className="text-sm font-medium hover:underline"
                  to={`/invoicing?open=${item.row.id}`}
                >
                  {item.title}
                </Link>
              ) : (
                <button
                  className="text-sm text-left font-medium hover:underline"
                  onClick={() => onOpen(item.kind as CrmObject, item.row)}
                >
                  {item.title}
                </button>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
            {item.kind === "invoices" && (
              <span className="text-sm tabular-nums">
                {money(Number(item.row.balance), text(item.row.currency) || "AED")}
              </span>
            )}
            <Badge tone={item.bucket === "overdue" ? "danger" : "neutral"}>
              {item.date ? fmtDate(item.date) : "No date"}
            </Badge>
            {item.kind === "tasks" ? (
              <button
                className="btn-ghost"
                disabled={disabled || busy !== null}
                aria-label={`Complete ${item.title}`}
                onClick={async () => {
                  if (completing.current) return;
                  completing.current = true;
                  setBusy(item.row.id);
                  setActionError("");
                  try {
                    await onComplete(item.row);
                  } catch (e) {
                    setActionError(errMsg(e));
                  } finally {
                    setBusy(null);
                    completing.current = false;
                  }
                }}
              >
                <Check size={14} />
                Complete
              </button>
            ) : (
              <button
                className="btn-ghost"
                disabled={disabled}
                onClick={() =>
                  onAdd("tasks", {
                    title: `Follow up: ${item.title}`,
                    due_date: today,
                    target:
                      item.kind === "invoices"
                        ? `invoice:${item.row.id}`
                        : targetTypes[item.kind]
                          ? `${targetTypes[item.kind]}:${item.row.id}`
                          : targetKey(item.row),
                  })
                }
              >
                <Plus size={14} />
                Follow up
              </button>
            )}
          </div>
        ))}
      </div>
      {visible.length > limit && (
        <button className="btn-ghost" onClick={() => setLimit((n) => n + 30)}>
          Show more
        </button>
      )}
    </div>
  );
}
