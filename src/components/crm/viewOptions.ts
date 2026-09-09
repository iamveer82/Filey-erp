import {
  CRM_OBJECTS,
  linkedName,
  recordName,
  text,
  type CrmData,
  type CrmObject,
  type CrmRow,
} from "../../lib/crmWorkspace";

export const DUE_FILTERS = [
  { value: "", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due in the next 7 days" },
  { value: "unscheduled", label: "No due date" },
];

/** Due views are actionable work: completed and cancelled tasks stay excluded. */
export function matchesDueFilter(row: CrmRow, due: string, today: string): boolean {
  if (!due || !DUE_FILTERS.some((item) => item.value === due)) return true;
  if (["done", "cancelled"].includes(text(row.status))) return false;
  const date = text(row.due_date).slice(0, 10);
  if (due === "unscheduled") return !date;
  if (!date) return false;
  if (due === "overdue") return date < today;
  if (due === "today") return date === today;
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return date >= today && date <= end.toISOString().slice(0, 10);
}

export function crmColumns(kind: CrmObject) {
  const spec = CRM_OBJECTS[kind];
  return [
    ...spec.fields.filter(
      (field) => field.key !== spec.title && field.type !== "textarea"
    ),
    { key: "created_at", label: "Created", type: "date" as const },
  ];
}

export function defaultCrmColumns(kind: CrmObject): string[] {
  return [
    ...crmColumns(kind)
      .filter(
        (field) =>
          field.type !== "checkbox" &&
          ![
            "linkedin",
            "country_code",
            "trn",
            "close_reason",
            "name",
            "probability",
            "created_at",
          ].includes(field.key)
      )
      .slice(0, 5)
      .map((field) => field.key),
    "created_at",
  ];
}

export function crmSortValue(
  kind: CrmObject,
  row: CrmRow,
  key: string,
  data: CrmData
): string | number {
  if (key === "record") return recordName(kind, row).toLocaleLowerCase();
  const field = CRM_OBJECTS[kind].fields.find((item) => item.key === key);
  if (field?.type === "target") return linkedName(row, data).toLocaleLowerCase();
  if (field?.type === "company" || field?.type === "contact") {
    const object = field.type === "company" ? "companies" : "contacts";
    const linked = data[object].find((item) => item.id === Number(row[key]));
    return linked ? recordName(object, linked).toLocaleLowerCase() : "";
  }
  if (field?.type === "number" || field?.type === "checkbox")
    return Number(row[key]) || 0;
  return text(row[key]).toLocaleLowerCase();
}
