export type WorkKind = "project" | "ticket";
export const WORK_STATUSES = {
  project: ["planned", "active", "blocked", "completed", "archived"],
  ticket: ["open", "in_progress", "waiting", "resolved", "closed", "archived"],
} as const;
export const WORK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ChecklistItem = { id: string; title: string; done: boolean };
export type TimeEntry = {
  id: string;
  date: string;
  minutes: number;
  note: string;
  person: string;
};
export type WorkUpdate = { at: string; body: string; author: string };
export interface WorkInput {
  kind: WorkKind;
  title: string;
  description: string;
  status: string;
  priority: string;
  owner: string;
  customer_id: number | null;
  invoice_id: number | null;
  due_date: string | null;
  budget_hours: number;
  checklist: ChecklistItem[];
  time_entries: TimeEntry[];
  updates: WorkUpdate[];
}
export interface WorkItem extends WorkInput {
  id: number;
  revision: number;
  created_at: string;
  updated_at: string;
}
export const newWorkItem = (kind: WorkKind): WorkInput => ({
  kind,
  title: "",
  description: "",
  status: WORK_STATUSES[kind][0],
  priority: "normal",
  owner: "",
  customer_id: null,
  invoice_id: null,
  due_date: null,
  budget_hours: 0,
  checklist: [],
  time_entries: [],
  updates: [],
});
export const workClosed = (status: string) =>
  ["completed", "resolved", "closed", "archived"].includes(status);
export const workMinutes = (item: Pick<WorkInput, "time_entries">) =>
  item.time_entries.reduce((sum, entry) => sum + entry.minutes, 0);
const validDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** The same validation applies to UI and agent writes; unknown fields never reach storage. */
export function validateWorkItem(input: WorkInput): WorkInput {
  if (!input || !["project", "ticket"].includes(input.kind))
    throw new Error("Choose a project or support ticket.");
  const text = (value: unknown, name: string, max: number, required = false) => {
    if (typeof value !== "string" || value.length > max || (required && !value.trim()))
      throw new Error(`${name} is required and must fit within ${max} characters.`);
    return value.trim();
  };
  if (!(WORK_STATUSES[input.kind] as readonly string[]).includes(input.status))
    throw new Error("Invalid status for this record.");
  if (!(WORK_PRIORITIES as readonly string[]).includes(input.priority))
    throw new Error("Choose a valid priority.");
  for (const id of [input.customer_id, input.invoice_id])
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0))
      throw new Error("Choose an existing related record.");
  if (input.due_date !== null && !validDay(input.due_date))
    throw new Error("Enter a valid due date.");
  if (
    !Number.isFinite(input.budget_hours) ||
    input.budget_hours < 0 ||
    input.budget_hours > 100000
  )
    throw new Error("Estimated hours must be between 0 and 100,000.");
  // ponytail: one atomic record keeps offline edits simple; split into child tables beyond these limits.
  if (
    !Array.isArray(input.checklist) ||
    input.checklist.length > 200 ||
    !Array.isArray(input.time_entries) ||
    input.time_entries.length > 500 ||
    !Array.isArray(input.updates) ||
    input.updates.length > 500
  )
    throw new Error("Record limit reached: 200 tasks, 500 time entries or 500 updates.");
  const seen = new Set<string>();
  const entryId = (id: string) => {
    if (typeof id !== "string" || !id || seen.has(id) || id.length > 100)
      throw new Error("Duplicate or invalid entry ID.");
    seen.add(id);
    return id;
  };
  return {
    kind: input.kind,
    title: text(input.title, "Title", 200, true),
    description: text(input.description, "Description", 20000),
    status: input.status,
    priority: input.priority,
    owner: text(input.owner, "Owner", 200),
    customer_id: input.customer_id,
    invoice_id: input.invoice_id,
    due_date: input.due_date,
    budget_hours: input.budget_hours,
    checklist: input.checklist.map((e) => {
      if (typeof e.done !== "boolean") throw new Error("Invalid task state.");
      return { id: entryId(e.id), title: text(e.title, "Task", 500, true), done: e.done };
    }),
    time_entries: input.time_entries.map((e) => {
      if (
        !validDay(e.date) ||
        !Number.isInteger(e.minutes) ||
        e.minutes < 1 ||
        e.minutes > 1440
      )
        throw new Error("Time entries need a valid date and 1–1440 minutes.");
      return {
        id: entryId(e.id),
        date: e.date,
        minutes: e.minutes,
        note: text(e.note, "Time note", 2000),
        person: text(e.person, "Person", 200, true),
      };
    }),
    updates: input.updates.map((e) => {
      if (typeof e.at !== "string" || Number.isNaN(Date.parse(e.at))) throw new Error("Invalid update date.");
      return {
        at: e.at,
        body: text(e.body, "Update", 5000, true),
        author: text(e.author, "Author", 200, true),
      };
    }),
  };
}
