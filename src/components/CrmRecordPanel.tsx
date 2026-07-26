import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  Loader2,
  Plus,
  Square,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  crm,
  type CrmNote,
  type CrmTargetType,
  type CrmTask,
} from "../lib/api";
import { cn, errMsg, fmtDate, localYmd } from "../lib/format";
import { useUI } from "../lib/ui";

/* Notes + tasks for ANY record.
 *
 * Both are stored against (target_type, target_id), so this one component
 * serves a company, a person, a deal or a lead without knowing anything about
 * the record it is attached to. That polymorphic link is what lets a task live
 * on the thing it is actually about instead of being matched back by name —
 * see supabase/2026-07-26-crm-objects.sql.
 */

type Tab = "notes" | "tasks";

const isOverdue = (t: CrmTask) =>
  t.status !== "done" && !!t.due_date && t.due_date < localYmd(new Date());

export default function CrmRecordPanel({
  targetType,
  targetId,
  className,
}: {
  targetType: CrmTargetType;
  targetId: number;
  className?: string;
}) {
  const { toast, confirm } = useUI();
  const [tab, setTab] = useState<Tab>("notes");
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useCallback(
    <T extends { target_type?: unknown; target_id?: unknown }>(rows: T[]) =>
      rows.filter(
        (r) => r.target_type === targetType && Number(r.target_id) === targetId
      ),
    [targetType, targetId]
  );

  const reload = useCallback(async () => {
    try {
      const [allNotes, allTasks] = await Promise.all([crm.notes(), crm.tasks()]);
      setNotes(mine(allNotes));
      setTasks(mine(allTasks));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
    // toast is recreated every render — depending on it would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  const sortedNotes = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          +new Date(b.created_at) - +new Date(a.created_at)
      ),
    [notes]
  );

  // Open tasks first, soonest due at the top; undated sink below dated ones.
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const done = Number(a.status === "done") - Number(b.status === "done");
        if (done) return done;
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1;
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return +new Date(b.created_at) - +new Date(a.created_at);
      }),
    [tasks]
  );

  const openCount = tasks.filter((t) => t.status !== "done").length;

  const add = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (tab === "notes") {
        await crm.addNote({ target_type: targetType, target_id: targetId, body: text });
      } else {
        await crm.addTask({
          target_type: targetType,
          target_id: targetId,
          title: text,
          due_date: due || undefined,
        });
      }
      setDraft("");
      setDue("");
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t: CrmTask) => {
    try {
      await crm.setTaskDone(t.id, t.status !== "done");
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (kind: Tab, id: number) => {
    const what = kind === "notes" ? "note" : "task";
    const ok = await confirm({
      title: `Delete this ${what}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      if (kind === "notes") await crm.deleteNote(id);
      else await crm.deleteTask(id);
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className={cn("rounded-xl border border-line bg-card", className)}>
      <div className="flex items-center gap-1 border-b border-line px-2">
        {(["notes", "tasks"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-sm capitalize transition-colors active:scale-[0.97]",
              tab === t
                ? "border-b-2 border-ink font-medium text-ink"
                : "text-muted-foreground hover:text-ink"
            )}
          >
            {t}
            {t === "tasks" && openCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={tab === "notes" ? "Write a note…" : "What needs doing?"}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        {tab === "tasks" && (
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm"
            aria-label="Due date"
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm text-bg transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : tab === "notes" ? (
          sortedNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No notes yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedNotes.map((n) => (
                <li
                  key={n.id}
                  className="group flex gap-2 rounded-lg border border-line p-2.5"
                >
                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">
                      {n.body}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {fmtDate(n.created_at)}
                      {n.author ? ` · ${n.author}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove("notes", n.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : sortedTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing to do here yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {sortedTasks.map((t) => (
              <li
                key={t.id}
                className="group flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-bg"
              >
                <button
                  type="button"
                  onClick={() => toggle(t)}
                  aria-label={t.status === "done" ? "Reopen task" : "Complete task"}
                >
                  {t.status === "done" ? (
                    <CheckSquare className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    t.status === "done"
                      ? "text-muted-foreground line-through"
                      : "text-ink"
                  )}
                >
                  {t.title}
                </span>
                {t.due_date && (
                  <span
                    className={cn(
                      "shrink-0 text-[11px]",
                      isOverdue(t)
                        ? "font-medium text-red-500"
                        : "text-muted-foreground"
                    )}
                  >
                    {fmtDate(t.due_date)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove("tasks", t.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete task"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
