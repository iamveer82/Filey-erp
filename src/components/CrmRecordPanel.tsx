import { FileySpinner as Loader2 } from "./FileySpinner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Plus, Square, StickyNote, Trash2 } from "lucide-react";
import {
  persistCrmRecord,
  removeCrmRecord,
  type CrmTargetType,
  type CrmTask,
} from "../lib/api";
import { loadCrmRecordContext } from "../lib/crmWorkspace";
import { useLiveSync } from "../lib/realtime";
import { cn, errMsg, fmtDate, localYmd } from "../lib/format";
import { useUI } from "../lib/ui";
import { ErrorBanner } from "./ui";

type Tab = "notes" | "tasks";
type Props = { targetType: CrmTargetType; targetId: number; className?: string };
const isClosed = (task: CrmTask) => ["done", "cancelled"].includes(task.status);
const isOverdue = (task: CrmTask) =>
  !isClosed(task) && !!task.due_date && task.due_date < localYmd(new Date());

/** Changing records also discards the old draft and pending view state. */
export default function CrmRecordPanel(props: Props) {
  return <RecordContext key={props.targetType + ":" + props.targetId} {...props} />;
}

function RecordContext({ targetType, targetId, className }: Props) {
  const { toast, confirm } = useUI();
  const [tab, setTab] = useState<Tab>("notes");
  const [context, setContext] = useState<
    Awaited<ReturnType<typeof loadCrmRecordContext>>
  >({ notes: [], tasks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({ notes: "", tasks: "" });
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    try {
      const next = await loadCrmRecordContext(targetType, targetId);
      if (active.current && version === request.current) {
        setContext(next);
        setError("");
      }
    } catch (e) {
      if (active.current && version === request.current) setError(errMsg(e));
    } finally {
      if (active.current && version === request.current) setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
    };
  }, [reload]);
  useLiveSync(reload);

  const sortedNotes = useMemo(
    () =>
      [...context.notes].sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          b.created_at.localeCompare(a.created_at)
      ),
    [context.notes]
  );
  const sortedTasks = useMemo(
    () =>
      [...context.tasks].sort(
        (a, b) =>
          Number(isClosed(a)) - Number(isClosed(b)) ||
          (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
          b.created_at.localeCompare(a.created_at)
      ),
    [context.tasks]
  );
  const openCount = context.tasks.filter((task) => !isClosed(task)).length;
  const disabled = loading || busy || !!error;

  const run = async (mutation: () => Promise<void>, clearDraft = false) => {
    if (inFlight.current || loading || error) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await mutation();
      if (!active.current) return;
      if (clearDraft) {
        setDrafts((previous) => ({ ...previous, [tab]: "" }));
        form.current?.reset();
      }
      await reload();
    } catch (e) {
      if (active.current) toast.error(errMsg(e));
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };

  const toggle = (task: CrmTask) =>
    run(async () => {
      const done = !isClosed(task);
      await persistCrmRecord(
        "crm_tasks",
        {
          status: done ? "done" : "open",
          completed_at: done ? new Date().toISOString() : null,
        },
        task.id
      );
    });
  const remove = (kind: Tab, id: number) =>
    run(async () => {
      const ok = await confirm({
        title: "Delete this " + (kind === "notes" ? "note" : "task") + "?",
        confirmLabel: "Delete",
        danger: true,
      });
      if (ok && active.current)
        await removeCrmRecord(kind === "notes" ? "crm_notes" : "crm_tasks", id);
    });

  return (
    <div
      className={cn("rounded-xl border border-border bg-card", className)}
      aria-busy={loading || busy}
    >
      <div
        className="flex items-center gap-1 border-b border-border p-2"
        role="group"
        aria-label="Record context"
      >
        {(["notes", "tasks"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            disabled={busy}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
            className={cn(
              "min-h-10 rounded-full px-3 py-2 text-[13px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === item
                ? "bg-hover font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item}
            {item === "tasks" && !error && openCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary-400/15 px-1.5 py-0.5 text-[11px] text-foreground">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!event.currentTarget.checkValidity()) return;
          const fields = new FormData(event.currentTarget);
          const body = String(fields.get("draft") || "").trim();
          if (!body) return;
          const due = String(fields.get("due") || "");
          void run(async () => {
            await persistCrmRecord(tab === "notes" ? "crm_notes" : "crm_tasks", {
              target_type: targetType,
              target_id: targetId,
              ...(tab === "notes"
                ? { body }
                : {
                    title: body,
                    due_date: due || null,
                    status: "open",
                    priority: "normal",
                  }),
            });
          }, true);
        }}
      >
        <fieldset
          disabled={disabled}
          className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row"
        >
          <input
            name="draft"
            value={drafts[tab]}
            onChange={(e) =>
              setDrafts((previous) => ({ ...previous, [tab]: e.target.value }))
            }
            required
            maxLength={tab === "notes" ? 20000 : 500}
            aria-label={tab === "notes" ? "New note" : "New task"}
            placeholder={tab === "notes" ? "Write a note…" : "What needs doing?"}
            className="input min-w-0 flex-1"
          />
          {tab === "tasks" && (
            <input
              type="date"
              name="due"
              className="input sm:w-40"
              aria-label="Due date"
            />
          )}
          <button
            type="submit"
            disabled={!drafts[tab].trim() || disabled}
            className="btn-primary"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}{" "}
            Add {tab === "notes" ? "note" : "task"}
          </button>
        </fieldset>
      </form>
      <div className="max-h-80 overflow-y-auto p-3">
        {loading ? (
          <div
            role="status"
            className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Loading record context…
          </div>
        ) : error ? (
          <div className="space-y-3">
            <ErrorBanner message={"Could not load notes and tasks: " + error} />
            <button className="btn-ghost" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : tab === "notes" ? (
          sortedNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No notes yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedNotes.map((note) => (
                <li
                  key={note.id}
                  className="flex gap-2 rounded-lg border border-border p-2.5"
                >
                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                      {note.body}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(note.created_at)}
                      {note.author ? " · " + note.author : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void remove("notes", note.id)}
                    className="btn-ghost w-10 p-0 shrink-0"
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : sortedTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="space-y-1">
            {sortedTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-hover"
              >
                <button
                  type="button"
                  disabled={disabled}
                  className="btn-ghost w-10 p-0 shrink-0"
                  onClick={() => void toggle(task)}
                  aria-label={
                    (isClosed(task) ? "Reopen" : "Complete") + " task: " + task.title
                  }
                >
                  {task.status === "done" ? (
                    <CheckSquare className="h-4 w-4 text-success" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm break-words",
                    isClosed(task)
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  )}
                >
                  {task.title}
                  {task.status === "cancelled" && (
                    <span className="ml-2 text-xs no-underline">Cancelled</span>
                  )}
                </span>
                {task.due_date && (
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      isOverdue(task)
                        ? "font-medium text-danger"
                        : "text-muted-foreground"
                    )}
                  >
                    {fmtDate(task.due_date)}
                  </span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  className="btn-ghost w-10 p-0 shrink-0"
                  onClick={() => void remove("tasks", task.id)}
                  aria-label={"Delete task: " + task.title}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
