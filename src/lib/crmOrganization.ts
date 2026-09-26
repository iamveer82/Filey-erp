import { persistCrmRecord } from "./api";
import { requireAgentStorageScope } from "./agentStorage";
import {
  CRM_OBJECTS,
  STAGE_PROB,
  recordDraft,
  validateCrmDraft,
  text,
  type CrmObject,
  type CrmRow,
  type CrmData,
} from "./crmWorkspace";

/** Exact identifiers flag review candidates; they never merge or delete records. */
export function crmDuplicates(kind: CrmObject, rows: CrmRow[]) {
  if (!["companies", "contacts", "leads"].includes(kind)) return [];
  const buckets = new Map<string, { reason: string; ids: number[] }>();
  const normalized = (value: unknown) =>
    text(value).normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  for (const row of rows) {
    const email = normalized(row.email),
      phone = text(row.phone_e164 || row.phone).replace(/\D/g, "");
    const company = normalized(kind === "contacts" ? row.company_id : row.company);
    const name = normalized(row.name);
    for (const [reason, value] of [
      ["Same email", email],
      ["Same phone", phone.length >= 7 ? phone : ""],
      ["Same company name", kind === "companies" ? company : ""],
      [
        "Same name and company",
        kind !== "companies" && company && name ? `${name}\n${company}` : "",
      ],
    ]) {
      if (!value) continue;
      const key = `${reason}:${value}`;
      if (!buckets.has(key)) buckets.set(key, { reason, ids: [] });
      buckets.get(key)!.ids.push(row.id);
    }
  }
  return [...buckets.values()].filter((group) => group.ids.length > 1);
}

export const crmBulkFields = (kind: CrmObject) =>
  CRM_OBJECTS[kind].fields.filter((field) =>
    ["owner", "assignee", "segment", "status", "stage", "priority", "due_date"].includes(
      field.key
    )
  );
export async function bulkUpdateCrm(
  kind: CrmObject,
  rows: CrmRow[],
  field: string,
  value: string,
  data: CrmData
) {
  const scope = requireAgentStorageScope();
  if (
    !crmBulkFields(kind).some((f) => f.key === field) ||
    !rows.length ||
    rows.length > 500
  )
    throw new Error("Choose one available field and between 1 and 500 records.");
  const patches = rows.map((row) => {
    const draft = { ...recordDraft(kind, row), [field]: value };
    if (field === "stage") draft.probability = String(STAGE_PROB[value] ?? 0);
    const full = validateCrmDraft(kind, draft, data, row);
    const keys = [
      field,
      ...(field === "stage"
        ? ["probability", "closed_at", "close_reason"]
        : field === "status" && kind === "tasks"
          ? ["completed_at"]
          : []),
    ];
    return Object.fromEntries(keys.map((key) => [key, full[key]]));
  });
  const updated: number[] = [],
    failed: { row: CrmRow; error: string }[] = [];
  // Sequential acknowledged writes make partial results explicit and stop at a workspace change.
  for (let index = 0; index < rows.length; index++) {
    requireAgentStorageScope(scope);
    const row = rows[index];
    try {
      await persistCrmRecord(
        CRM_OBJECTS[kind].table,
        patches[index],
        row.id,
        text(row.updated_at) || null
      );
      updated.push(row.id);
    } catch (e) {
      failed.push({ row, error: e instanceof Error ? e.message : String(e) });
    }
  }
  requireAgentStorageScope(scope);
  return { updated, failed };
}
