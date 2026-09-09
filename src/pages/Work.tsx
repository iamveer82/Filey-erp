import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Plus, RefreshCw, Download, ArrowLeft, Trash2 } from "lucide-react";
import { work, crm, billing, type CrmCustomer, type InvoiceDocSummary } from "../lib/api";
import {
  newWorkItem,
  WORK_STATUSES,
  WORK_PRIORITIES,
  workClosed,
  workMinutes,
  type WorkItem,
  type WorkInput,
  type WorkKind,
} from "../lib/workItems";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { downloadCsv } from "../lib/csv";
import { errMsg, fmtDate, todayYmd } from "../lib/format";
import {
  PageHeader,
  DataTable,
  Field,
  ErrorBanner,
  Badge,
  SearchInput,
} from "../components/ui";

export default function Work() {
  const kind: WorkKind = useLocation().pathname === "/helpdesk" ? "ticket" : "project";
  const label = kind === "ticket" ? "Helpdesk" : "Projects";
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open_work");
  const [draft, setDraft] = useState<WorkInput | null>(null);
  const [original, setOriginal] = useState<WorkItem | null>(null);
  const [task, setTask] = useState("");
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [timeNote, setTimeNote] = useState("");
  const [timeDate, setTimeDate] = useState(todayYmd());
  const author = user?.email || "Local user";
  const load = async () => {
    try {
      const [rows, people, docs] = await Promise.all([
        work.list(),
        crm.customers(),
        billing.listDocs(),
      ]);
      setItems(rows);
      setCustomers(people);
      setInvoices(docs);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useLiveSync(() => {
    void load();
  });
  useEffect(() => {
    setDraft(null);
    setOriginal(null);
    setStatus("open_work");
    setSearch("");
  }, [kind]);
  const edit = (row?: WorkItem) => {
    setOriginal(row || null);
    setDraft(row ? structuredClone(row) : newWorkItem(kind));
    setTask("");
    setNote("");
    setTimeNote("");
    setError("");
  };
  const patch = (value: Partial<WorkInput>) => setDraft((d) => d && { ...d, ...value });
  const close = async () => {
    if (busy) return;
    if (
      JSON.stringify(draft) !== JSON.stringify(original || newWorkItem(kind)) &&
      !(await confirm({
        title: "Discard unsaved changes?",
        message: "Your saved record will stay unchanged.",
        confirmLabel: "Discard",
      }))
    )
      return;
    setDraft(null);
    setOriginal(null);
    setError("");
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = { ...draft, updates: [...draft.updates] };
      if (note.trim())
        next.updates.push({ at: new Date().toISOString(), body: note.trim(), author });
      if (original && original.status !== draft.status)
        next.updates.push({
          at: new Date().toISOString(),
          body: `Status: ${original.status} → ${draft.status}`,
          author,
        });
      await work.save(next, original?.id, original?.revision);
      setDraft(null);
      setOriginal(null);
      setNote("");
      toast.success(`${kind === "ticket" ? "Ticket" : "Project"} saved`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = items.filter((item) => item.kind === kind);
  const filtered = rows.filter(
    (item) =>
      (status === "all" ||
        (status === "open_work" ? !workClosed(item.status) : item.status === status)) &&
      `${item.title} ${item.owner} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const overdue = rows.filter(
    (item) => !workClosed(item.status) && item.due_date && item.due_date < todayYmd()
  ).length;

  if (draft)
    return (
      <div className="space-y-5">
        <PageHeader
          title={original ? draft.title : `New ${kind}`}
          subtitle="Changes are saved together. Linked business records keep their own status."
          action={
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => void close()}>
                <ArrowLeft size={14} /> Back
              </button>
              <button className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : original ? "Save changes" : `Create ${kind}`}
              </button>
            </div>
          }
        />
        {error && <ErrorBanner message={error} />}
        <fieldset
          disabled={busy}
          className="min-w-0 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]"
        >
          <div className="min-w-0 space-y-5">
            <Field label="Title *">
              <input
                className="input"
                aria-label="Title"
                required
                value={draft.title}
                maxLength={200}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea min-h-32"
                aria-label="Description"
                value={draft.description}
                maxLength={20000}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <section className="border-t border-border pt-4 space-y-3">
              <h2 className="text-sm font-semibold">
                Tasks{" "}
                <span className="text-muted-foreground font-normal">
                  {draft.checklist.filter((t) => t.done).length}/{draft.checklist.length}
                </span>
              </h2>
              {draft.checklist.map((t) => (
                <div key={t.id} className="flex gap-2 items-center">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={(e) =>
                        patch({
                          checklist: draft.checklist.map((x) =>
                            x.id === t.id ? { ...x, done: e.target.checked } : x
                          ),
                        })
                      }
                    />
                    <span
                      className={
                        t.done
                          ? "line-through text-muted-foreground break-words"
                          : "break-words"
                      }
                    >
                      {t.title}
                    </span>
                  </label>
                  <button
                    className="btn-ghost"
                    aria-label={`Remove task ${t.title}`}
                    onClick={() =>
                      patch({ checklist: draft.checklist.filter((x) => x.id !== t.id) })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (task.trim()) {
                    patch({
                      checklist: [
                        ...draft.checklist,
                        { id: crypto.randomUUID(), title: task.trim(), done: false },
                      ],
                    });
                    setTask("");
                  }
                }}
              >
                <input
                  className="input flex-1 min-w-40"
                  aria-label="New task"
                  placeholder="Add a task"
                  value={task}
                  maxLength={500}
                  onChange={(e) => setTask(e.target.value)}
                />
                <button
                  className="btn-ghost"
                  disabled={!task.trim() || draft.checklist.length >= 200}
                >
                  Add task
                </button>
              </form>
            </section>
            <section className="border-t border-border pt-4 space-y-3">
              <h2 className="text-sm font-semibold">
                Time entries{" "}
                <span className="text-muted-foreground font-normal">
                  {(workMinutes(draft) / 60).toFixed(2)} hours logged
                </span>
              </h2>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    Number.isInteger(minutes) &&
                    minutes > 0 &&
                    minutes <= 1440 &&
                    timeDate
                  ) {
                    patch({
                      time_entries: [
                        ...draft.time_entries,
                        {
                          id: crypto.randomUUID(),
                          date: timeDate,
                          minutes,
                          note: timeNote.trim(),
                          person: author,
                        },
                      ],
                    });
                    setTimeNote("");
                  }
                }}
              >
                <Field label="Work date">
                  <input
                    className="input"
                    type="date"
                    aria-label="Work date"
                    required
                    value={timeDate}
                    onChange={(e) => setTimeDate(e.target.value)}
                  />
                </Field>
                <Field label="Minutes">
                  <input
                    className="input"
                    type="number"
                    aria-label="Minutes"
                    min={1}
                    max={1440}
                    step={1}
                    required
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </Field>
                <input
                  className="input"
                  aria-label="Time entry note"
                  placeholder="What did you work on?"
                  value={timeNote}
                  maxLength={2000}
                  onChange={(e) => setTimeNote(e.target.value)}
                />
                <button
                  className="btn-ghost justify-self-start"
                  disabled={draft.time_entries.length >= 500}
                >
                  Add time entry
                </button>
              </form>
              <div className="divide-y divide-border">
                {draft.time_entries
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <div key={entry.id} className="flex gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{entry.note || "Work logged"}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {fmtDate(entry.date)} · {entry.person}
                        </p>
                      </div>
                      <span className="whitespace-nowrap tabular-nums">
                        {entry.minutes} min
                      </span>
                      <button
                        className="btn-ghost"
                        aria-label={`Remove time entry ${entry.date}`}
                        onClick={() =>
                          patch({
                            time_entries: draft.time_entries.filter(
                              (x) => x.id !== entry.id
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
              </div>
            </section>
            <section className="border-t border-border pt-4 space-y-3">
              <h2 className="text-sm font-semibold">Updates</h2>
              <textarea
                className="textarea"
                aria-label="New update"
                placeholder="Add context for the next person. Saved with your changes."
                value={note}
                maxLength={5000}
                onChange={(e) => setNote(e.target.value)}
              />
              {draft.updates
                .slice()
                .reverse()
                .map((entry, i) => (
                  <div key={`${entry.at}-${i}`} className="border-b border-border py-3">
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {entry.body}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 break-words">
                      {entry.author} · {new Date(entry.at).toLocaleString()}
                    </p>
                  </div>
                ))}
            </section>
          </div>
          <div className="space-y-4 min-w-0">
            <Field label="Status">
              <select
                aria-label="Status"
                className="select"
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value })}
              >
                {WORK_STATUSES[kind].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                aria-label="Priority"
                className="select"
                value={draft.priority}
                onChange={(e) => patch({ priority: e.target.value })}
              >
                {WORK_PRIORITIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Owner">
              <input
                aria-label="Owner"
                className="input"
                value={draft.owner}
                maxLength={200}
                onChange={(e) => patch({ owner: e.target.value })}
              />
            </Field>
            <Field label={kind === "ticket" ? "Resolution target" : "Due date"}>
              <input
                aria-label="Due date"
                type="date"
                className="input"
                value={draft.due_date || ""}
                onChange={(e) => patch({ due_date: e.target.value || null })}
              />
            </Field>
            <Field label="Estimated hours">
              <input
                aria-label="Estimated hours"
                type="number"
                min={0}
                max={100000}
                step="0.25"
                className="input"
                value={draft.budget_hours}
                onChange={(e) => patch({ budget_hours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Customer">
              <select
                aria-label="Customer"
                className="select"
                value={draft.customer_id || ""}
                onChange={(e) => patch({ customer_id: Number(e.target.value) || null })}
              >
                <option value="">No linked customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company || c.name}
                  </option>
                ))}
              </select>
            </Field>
            {draft.customer_id && (
              <Link
                className="text-sm underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
                to={`/customers/${draft.customer_id}`}
              >
                Open customer
              </Link>
            )}
            <Field label="Invoice">
              <select
                aria-label="Invoice"
                className="select"
                value={draft.invoice_id || ""}
                onChange={(e) => patch({ invoice_id: Number(e.target.value) || null })}
              >
                <option value="">No linked invoice</option>
                {invoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} · {d.customer_name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Owner is a coordination label, not an access grant. This record belongs to
              the current account. Archive it to keep its history.
            </p>
          </div>
        </fieldset>
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-canvas py-3">
          <button className="btn-ghost" disabled={busy} onClick={() => void close()}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : original ? "Save changes" : `Create ${kind}`}
          </button>
        </div>
      </div>
    );

  if (error) {
    const needsSetup =
      error.includes("work_items") && /schema|does not exist/i.test(error);
    return (
      <div className="space-y-5">
        <PageHeader
          title={label}
          subtitle="Customer work, tasks, and time in one workspace."
        />
        <section className="border-y border-border py-6 space-y-3 max-w-2xl" role="alert">
          <h2 className="text-base font-semibold">
            {needsSetup ? "Cloud setup required" : "Records could not be loaded"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {needsSetup
              ? `${label} needs an administrator to complete the cloud database update. You can use this module in the local edition from Data & Storage.`
              : error}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => void load()}>
              <RefreshCw size={14} /> Retry
            </button>
            <Link className="btn-ghost" to="/settings?section=datamode">
              Open Data & Storage
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={label}
        subtitle={
          kind === "ticket"
            ? "Resolve customer issues with clear ownership, context, and next steps."
            : "Deliver customer work with tasks, deadlines, and tracked time."
        }
        action={
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              aria-label={`Refresh ${label}`}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn-primary"
              disabled={loading || !!error}
              onClick={() => edit()}
            >
              <Plus size={14} /> New {kind}
            </button>
          </div>
        }
      />
      {error && (
        <div className="space-y-2">
          <ErrorBanner message={error} />
          <p className="text-sm text-muted-foreground">
            Retry the connection. A self-hosted cloud deployment also needs the work-items
            database migration; local storage is ready without it.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-y border-border py-4">
        {[
          ["Open", rows.filter((r) => !workClosed(r.status)).length],
          ["Past target", overdue],
          [
            "Hours logged",
            (rows.reduce((sum, r) => sum + workMinutes(r), 0) / 60).toFixed(2),
          ],
          [
            "Completed",
            rows.filter((r) => workClosed(r.status) && r.status !== "archived").length,
          ],
        ].map(([title, value]) => (
          <div key={title}>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {loading || error ? "—" : value}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${label.toLowerCase()}`}
        />
        <select
          className="select w-auto"
          aria-label="Filter status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open_work">Open work</option>
          <option value="all">All records</option>
          {WORK_STATUSES[kind].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button
          className="btn-ghost"
          disabled={!filtered.length}
          onClick={() =>
            void downloadCsv(
              `${kind}s.csv`,
              filtered.map((r) => ({
                title: r.title,
                status: r.status,
                owner: r.owner,
                priority: r.priority,
                due_date: r.due_date,
                customer_id: r.customer_id,
                invoice_id: r.invoice_id,
                hours: workMinutes(r) / 60,
                estimated_hours: r.budget_hours,
              }))
            ).catch((e) => toast.error(errMsg(e)))
          }
        >
          <Download size={14} /> Export
        </button>
      </div>
      <DataTable
        rows={filtered}
        loading={loading}
        empty={
          error
            ? "Records could not be loaded. Retry above."
            : `No ${kind}s match this view. Create one to get started.`
        }
        pageSize={15}
        columns={[
          {
            key: "title",
            label: "Title",
            sortValue: (r) => r.title,
            render: (r) => (
              <button
                className="text-left font-medium hover:underline break-words"
                onClick={() => edit(r)}
              >
                {r.title}
              </button>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge tone={workClosed(r.status) ? "success" : "neutral"}>
                {r.status.replace(/_/g, " ")}
              </Badge>
            ),
          },
          { key: "owner", label: "Owner", render: (r) => r.owner || "Unassigned" },
          {
            key: "priority",
            label: "Priority",
            render: (r) => (
              <Badge tone={r.priority === "urgent" ? "danger" : "neutral"}>
                {r.priority}
              </Badge>
            ),
          },
          {
            key: "due",
            label: "Target",
            sortValue: (r) => r.due_date || "",
            render: (r) => (
              <span className="whitespace-nowrap">
                {r.due_date ? fmtDate(r.due_date) : "No date"}
              </span>
            ),
          },
          {
            key: "progress",
            label: "Tasks",
            render: (r) =>
              `${r.checklist.filter((t) => t.done).length}/${r.checklist.length}`,
          },
          {
            key: "time",
            label: "Hours",
            render: (r) => (workMinutes(r) / 60).toFixed(2),
          },
        ]}
      />
    </div>
  );
}
