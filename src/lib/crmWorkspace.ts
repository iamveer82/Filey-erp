import {
  crm,
  persistCrmRecord,
  removeCrmRecord,
  type Opportunity,
  type CrmTargetType,
  type CrmNote,
  type CrmTask,
} from "./api";
import { sb } from "./supabase";
import { isLocalMode } from "./dataMode";
import { requireAgentStorageScope } from "./agentStorage";
import { syncCustomFields, validateCustomValue } from "./customFields";

export type CrmObject =
  | "companies"
  | "contacts"
  | "leads"
  | "deals"
  | "tasks"
  | "notes"
  | "activities";
export type CrmRow = { id: number; created_at?: string; [key: string]: unknown };
export type CrmData = Record<CrmObject, CrmRow[]>;
export type CrmField = {
  key: string;
  label: string;
  type?:
    | "email"
    | "tel"
    | "date"
    | "number"
    | "textarea"
    | "select"
    | "company"
    | "contact"
    | "target"
    | "checkbox";
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
};
export const STAGES = ["qualification", "proposal", "negotiation", "won", "lost"];
export const STAGE_PROB: Record<string, number> = {
  qualification: 20,
  proposal: 45,
  negotiation: 70,
  won: 100,
  lost: 0,
};
export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"];
const contactFields: CrmField[] = [
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone (international format)", type: "tel" },
];
const owner: CrmField = { key: "owner", label: "Owner" };
const target: CrmField = { key: "target", label: "Related record", type: "target" };
export const CRM_OBJECTS: Record<
  CrmObject,
  {
    label: string;
    singular: string;
    table: string;
    title: string;
    group: string;
    fields: CrmField[];
  }
> = {
  companies: {
    label: "Companies",
    singular: "company",
    table: "crm_customers",
    title: "company",
    group: "segment",
    fields: [
      { key: "company", label: "Company name", required: true },
      { key: "name", label: "Primary contact" },
      ...contactFields,
      { key: "segment", label: "Segment" },
      { key: "address", label: "Address", type: "textarea" },
      { key: "city", label: "City" },
      { key: "country_code", label: "Country code (e.g. AE)" },
      { key: "trn", label: "Tax registration number" },
    ],
  },
  contacts: {
    label: "Contacts",
    singular: "contact",
    table: "crm_people",
    title: "name",
    group: "owner",
    fields: [
      { key: "name", label: "Full name", required: true },
      { key: "company_id", label: "Company", type: "company" },
      { key: "title", label: "Job title" },
      ...contactFields,
      owner,
      { key: "linkedin", label: "LinkedIn URL" },
      { key: "telegram", label: "Telegram username" },
      { key: "is_primary", label: "Primary contact", type: "checkbox" },
    ],
  },
  leads: {
    label: "Leads",
    singular: "lead",
    table: "crm_leads",
    title: "name",
    group: "status",
    fields: [
      { key: "name", label: "Full name", required: true },
      { key: "company", label: "Company" },
      ...contactFields,
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["new", "contacted", "qualified", "lost"],
      },
      { key: "source", label: "Source" },
      { key: "est_value", label: "Estimated value (AED)", type: "number", min: 0 },
      owner,
    ],
  },
  deals: {
    label: "Deals",
    singular: "deal",
    table: "crm_opportunities",
    title: "title",
    group: "stage",
    fields: [
      { key: "title", label: "Deal name", required: true },
      { key: "customer_id", label: "Company", type: "company", required: true },
      { key: "person_id", label: "Contact", type: "contact" },
      { key: "stage", label: "Stage", type: "select", options: STAGES },
      { key: "value", label: "Value (AED)", type: "number", min: 0 },
      { key: "probability", label: "Probability (%)", type: "number", min: 0, max: 100 },
      { key: "expected_close", label: "Expected close", type: "date" },
      owner,
      { key: "close_reason", label: "Win / loss reason" },
    ],
  },
  tasks: {
    label: "Tasks",
    singular: "task",
    table: "crm_tasks",
    title: "title",
    group: "status",
    fields: [
      { key: "title", label: "Task title", required: true },
      { key: "body", label: "Description", type: "textarea" },
      target,
      { key: "status", label: "Status", type: "select", options: TASK_STATUSES },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        options: ["normal", "low", "high", "urgent"],
      },
      { key: "due_date", label: "Due date", type: "date" },
      { key: "assignee", label: "Assignee" },
    ],
  },
  notes: {
    label: "Notes",
    singular: "note",
    table: "crm_notes",
    title: "body",
    group: "target_type",
    fields: [
      { key: "body", label: "Note", type: "textarea", required: true },
      { ...target, required: true },
      { key: "author", label: "Author" },
      { key: "pinned", label: "Pinned", type: "checkbox" },
    ],
  },
  activities: {
    label: "Activity",
    singular: "activity",
    table: "crm_activities",
    title: "subject",
    group: "kind",
    fields: [
      { key: "subject", label: "Subject", required: true },
      {
        key: "kind",
        label: "Type",
        type: "select",
        options: ["call", "email", "meeting", "whatsapp", "telegram", "task", "note"],
      },
      target,
      { key: "due_date", label: "Scheduled date", type: "date" },
      { key: "done", label: "Completed", type: "checkbox" },
    ],
  },
};
export const OBJECT_KEYS = Object.keys(CRM_OBJECTS) as CrmObject[];
export const emptyCrmData = (): CrmData => ({
  companies: [],
  contacts: [],
  leads: [],
  deals: [],
  tasks: [],
  notes: [],
  activities: [],
});
export const targetTypes: Partial<Record<CrmObject, string>> = {
  companies: "company",
  contacts: "person",
  deals: "deal",
  leads: "lead",
};
export const objectForTarget = (type: unknown) =>
  OBJECT_KEYS.find((key) => targetTypes[key] === type);
export const text = (value: unknown): string => (value == null ? "" : String(value));
export const label = (value: unknown) =>
  text(value)
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
export const recordName = (kind: CrmObject, row: CrmRow) =>
  text(row[CRM_OBJECTS[kind].title] || row.name || `Record #${row.id}`);
export const targetKey = (row: CrmRow) =>
  row.target_type && row.target_id ? `${row.target_type}:${row.target_id}` : "";
export function linkedName(row: CrmRow, data: CrmData): string {
  const kind = objectForTarget(row.target_type);
  const linked = kind && data[kind].find((r) => r.id === Number(row.target_id));
  return kind && linked
    ? recordName(kind, linked)
    : row.target_type
      ? `${label(row.target_type)} #${row.target_id}${row.target_type === "invoice" ? "" : " (unavailable)"}`
      : "Unlinked";
}

/** Search the names people see, including linked records, rather than only stored IDs. */
export function matchesCrmSearch(
  kind: CrmObject,
  row: CrmRow,
  data: CrmData,
  query: string
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const values = [
    recordName(kind, row),
    ...Object.values(row).filter((v) => typeof v === "string"),
  ];
  for (const field of CRM_OBJECTS[kind].fields) {
    if (field.type === "target" && targetKey(row)) values.push(linkedName(row, data));
    if (field.type === "company" || field.type === "contact") {
      const relatedKind = field.type === "company" ? "companies" : "contacts";
      const related = data[relatedKind].find((r) => r.id === Number(row[field.key]));
      if (related) values.push(recordName(relatedKind, related));
    }
    if (field.type === "select") values.push(label(row[field.key]));
  }
  return values.join(" ").toLocaleLowerCase().includes(needle);
}

/** Keep exported relationship values compatible with the CSV importer. */
export function crmExportRows(
  kind: CrmObject,
  rows: CrmRow[]
): Record<string, unknown>[] {
  return rows.map((row) => ({
    id: row.id,
    ...Object.fromEntries(
      CRM_OBJECTS[kind].fields.map((field) => [
        field.key,
        field.type === "target" ? targetKey(row) : row[field.key],
      ])
    ),
    created_at: row.created_at,
  }));
}

/** Cloud pages avoid PostgREST's row cap. Keep one client for the entire read. */
async function readCrmRows(
  kind: CrmObject,
  target?: { type: CrmTargetType; id: number }
): Promise<CrmRow[]> {
  const client = sb();
  const local = isLocalMode();
  const rows: CrmRow[] = [];
  let cursor = 0;
  for (;;) {
    let query = client
      .from(CRM_OBJECTS[kind].table)
      .select("*")
      .order("id", { ascending: true });
    if (target) query = query.eq("target_type", target.type).eq("target_id", target.id);
    if (!local) query = query.gt("id", cursor).limit(500);
    const { data, error } = await query;
    if (error) throw new Error(`${CRM_OBJECTS[kind].label}: ${error.message}`);
    const page = (data || []) as CrmRow[];
    rows.push(...page);
    if (local || page.length < 500) break;
    const next = Number(page[page.length - 1].id);
    if (!Number.isSafeInteger(next) || next <= cursor)
      throw new Error("CRM pagination did not advance. Refresh to try again.");
    cursor = next;
  }
  return rows;
}

export async function loadCrmData(): Promise<CrmData> {
  const entries = await Promise.all(
    OBJECT_KEYS.map(async (kind) => [kind, await readCrmRows(kind)] as const)
  );
  return Object.fromEntries(entries) as CrmData;
}

/** Detail panels read only their own context, with the same pagination/error rules. */
export async function loadCrmRecordContext(
  type: CrmTargetType,
  id: number
): Promise<{ notes: CrmNote[]; tasks: CrmTask[] }> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Choose an existing record first.");
  const [notes, tasks] = await Promise.all([
    readCrmRows("notes", { type, id }),
    readCrmRows("tasks", { type, id }),
  ]);
  return { notes: notes as unknown as CrmNote[], tasks: tasks as unknown as CrmTask[] };
}

/** Board moves change status fields only; a stale card must not replace someone's edited title/value. */
export async function saveCrmStatus(
  kind: "deals" | "tasks",
  row: CrmRow,
  value: string
): Promise<void> {
  const allowed = kind === "deals" ? STAGES : TASK_STATUSES;
  if (!allowed.includes(value)) throw new Error("Choose an available stage or status.");
  const field = CRM_OBJECTS[kind].group;
  if (row[field] === value) return;
  const now = new Date().toISOString();
  const patch =
    kind === "tasks"
      ? { status: value, completed_at: value === "done" ? now : null }
      : {
          stage: value,
          probability: STAGE_PROB[value],
          closed_at: ["won", "lost"].includes(value) ? row.closed_at || now : null,
          ...(!["won", "lost"].includes(value) ? { close_reason: null } : {}),
        };
  await persistCrmRecord(CRM_OBJECTS[kind].table, patch, row.id);
}

export function recordDraft(kind: CrmObject, row?: CrmRow): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of CRM_OBJECTS[kind].fields) {
    draft[field.key] = row
      ? field.type === "target"
        ? targetKey(row)
        : text(row[field.key]) || field.options?.[0] || ""
      : field.options?.[0] || (field.type === "checkbox" ? "false" : "");
  }
  if (!row && kind === "deals") draft.probability = "20";
  if (!row && kind === "companies") draft.country_code = "AE";
  return draft;
}

/** Form + CSV import share one allowlist and validation path. */
export function validateCrmDraft(
  kind: CrmObject,
  draft: Record<string, string>,
  data: CrmData,
  previous?: CrmRow
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of CRM_OBJECTS[kind].fields) {
    const value = (draft[field.key] || "").trim();
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (value.length > (field.type === "textarea" ? 20000 : 500))
      throw new Error(`${field.label} is too long.`);
    if (field.type === "number") {
      const number = Number(value || 0);
      if (
        !Number.isFinite(number) ||
        number < (field.min ?? -Infinity) ||
        number > (field.max ?? Infinity)
      )
        throw new Error(`${field.label} is outside the allowed range.`);
      if (field.key === "probability" && !Number.isInteger(number))
        throw new Error("Probability must be a whole percentage.");
      patch[field.key] = number;
    } else if (field.type === "checkbox") {
      if (value && !["true", "false"].includes(value.toLowerCase()))
        throw new Error(`Use true or false for ${field.label.toLowerCase()}.`);
      patch[field.key] = value.toLowerCase() === "true";
    } else if (field.type === "target") {
      const [type, rawId, extra] = value.split(":");
      const linkedKind = objectForTarget(type);
      if (
        value &&
        (extra != null ||
          !Number.isSafeInteger(Number(rawId)) ||
          Number(rawId) <= 0 ||
          (type !== "invoice" &&
            (!linkedKind || !data[linkedKind].some((r) => r.id === Number(rawId)))))
      ) {
        // Preserve legacy links to invoices/employees even when those objects are not loaded here.
        if (value !== (previous && targetKey(previous)))
          throw new Error("Choose an available related record.");
      }
      patch.target_type = type || null;
      patch.target_id = value ? Number(rawId) : null;
    } else if (field.type === "company" || field.type === "contact") {
      const list = field.type === "company" ? data.companies : data.contacts;
      if (value && !list.some((r) => r.id === Number(value))) {
        if (value !== text(previous?.[field.key]))
          throw new Error(`${field.label} is unavailable. Choose another record.`);
      }
      patch[field.key] = value ? Number(value) : null;
    } else {
      if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new Error("Enter a valid email address.");
      if (
        field.type === "date" &&
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
      )
        throw new Error(`Enter a valid ${field.label.toLowerCase()}.`);
      if (
        field.options &&
        !field.options.includes(value) &&
        value !== text(previous?.[field.key])
      )
        throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
      patch[field.key] = value || (field.required ? "" : null);
    }
  }
  if (
    kind === "leads" &&
    previous?.status === "converted" &&
    patch.status !== "converted"
  )
    throw new Error(
      "This lead is already converted. Continue with its linked company, contact and deal."
    );
  if (kind === "companies") {
    patch.name = patch.name || patch.company;
    if (patch.country_code && !/^[A-Za-z]{2}$/.test(text(patch.country_code)))
      throw new Error("Use a two-letter country code, such as AE.");
    patch.country_code = text(patch.country_code).toUpperCase() || null;
  }
  if (
    kind === "contacts" &&
    patch.linkedin &&
    !/^https:\/\/([\w-]+\.)?linkedin\.com\//i.test(text(patch.linkedin))
  )
    throw new Error("Use a full https://www.linkedin.com/ URL.");
  if (kind === "contacts" && patch.telegram) {
    patch.telegram = text(patch.telegram).replace(/^@/, "");
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text(patch.telegram)))
      throw new Error(
        "Enter a valid Telegram username (5–32 letters, numbers or underscores)."
      );
  }
  if (kind === "deals") {
    const company = data.companies.find((r) => r.id === patch.customer_id);
    patch.customer_name = company
      ? recordName("companies", company)
      : previous?.customer_name || "";
    const contact = data.contacts.find((r) => r.id === patch.person_id);
    if (contact && contact.company_id && Number(contact.company_id) !== patch.customer_id)
      throw new Error("Choose a contact at the selected company.");
    const closed = patch.stage === "won" || patch.stage === "lost";
    patch.closed_at = closed ? previous?.closed_at || new Date().toISOString() : null;
    if (closed) patch.probability = patch.stage === "won" ? 100 : 0;
    else patch.close_reason = null;
  }
  if (kind === "tasks")
    patch.completed_at =
      patch.status === "done" ? previous?.completed_at || new Date().toISOString() : null;
  return patch;
}

export async function saveCrmRecord(
  kind: CrmObject,
  draft: Record<string, string>,
  data: CrmData,
  previous?: CrmRow
): Promise<number> {
  const patch = validateCrmDraft(kind, draft, data, previous);
  if (draft.custom_fields !== undefined) {
    const module =
      kind === "companies" ? "customers" : kind === "contacts" ? "contacts" : null;
    if (!module)
      throw new Error("Custom fields are supported for companies and contacts.");
    const scope = requireAgentStorageScope();
    const values = JSON.parse(draft.custom_fields);
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error("Custom field values must be an object.");
    const defs = await syncCustomFields(module);
    if (Object.keys(values).some((key) => !defs.some((def) => def.key === key)))
      throw new Error("Custom fields changed. Reopen the record before saving.");
    const custom = { ...((previous?.custom_fields as Record<string, unknown>) || {}) };
    for (const def of defs) {
      const value = values[def.key] ?? "";
      const problem = validateCustomValue(def, value);
      if (problem) throw new Error(problem);
      custom[def.key] = value;
    }
    requireAgentStorageScope(scope);
    patch.custom_fields = custom;
  }
  if (patch.target_type === "invoice") {
    const scope = requireAgentStorageScope();
    const { data: invoice, error } = await sb()
      .from("invoice_docs")
      .select("id")
      .eq("id", patch.target_id)
      .single();
    if (error || !invoice)
      throw new Error(
        "The linked invoice is unavailable. Choose another related record."
      );
    requireAgentStorageScope(scope);
  }
  return persistCrmRecord(CRM_OBJECTS[kind].table, patch, previous?.id);
}

export async function deleteCrmRecord(kind: CrmObject, row: CrmRow, data: CrmData) {
  const linked =
    (kind === "companies" &&
      (data.contacts.some((r) => Number(r.company_id) === row.id) ||
        data.deals.some((r) => Number(r.customer_id) === row.id))) ||
    (kind === "contacts" && data.deals.some((r) => Number(r.person_id) === row.id));
  const type = targetTypes[kind];
  const attached =
    type &&
    [data.notes, data.tasks, data.activities].some((list) =>
      list.some((r) => r.target_type === type && Number(r.target_id) === row.id)
    );
  if (linked || attached)
    throw new Error(
      "This record has linked records. Reassign or remove them before deleting it."
    );
  await removeCrmRecord(CRM_OBJECTS[kind].table, row.id);
}

export const crmDeals = (data: CrmData) => data.deals as unknown as Opportunity[];
export const convertCrmLead = (id: number) => crm.convertLead(id);

/** A date-only task exports as an all-day event. No calendar account or API key needed. */
export function tasksCalendar(tasks: CrmRow[], now = new Date()): string {
  const escape = (value: unknown) =>
    text(value)
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\p{Cc}/gu, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Filey//CRM//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const task of tasks) {
    const due = text(task.due_date);
    if (
      task.status === "done" ||
      task.status === "cancelled" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      !Number.isFinite(Date.parse(due))
    )
      continue;
    const next = new Date(`${due}T00:00:00Z`);
    if (next.toISOString().slice(0, 10) !== due) continue;
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:filey-task-${task.id}-${escape(task.created_at || "local").replace(/[^\w-]/g, "")}@filey`,
      `DTSTAMP:${now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
      `DTSTART;VALUE=DATE:${due.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escape(task.title)}`,
      `DESCRIPTION:${escape(task.body)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  // RFC 5545: fold at 75 UTF-8 octets, without splitting a Unicode character.
  return (
    lines
      .map((line) => {
        let folded = "",
          length = 0;
        for (const character of line) {
          const size = new TextEncoder().encode(character).length;
          if (length + size > 75) {
            folded += "\r\n ";
            length = 1;
          }
          folded += character;
          length += size;
        }
        return folded;
      })
      .join("\r\n") + "\r\n"
  );
}
