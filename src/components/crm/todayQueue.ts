import {
  linkedName,
  recordName,
  text,
  type CrmData,
  type CrmRow,
  type CrmObject,
} from "../../lib/crmWorkspace";
import type { InvoiceDocSummary } from "../../lib/api";
export type TodayItem = {
  kind: CrmObject | "invoices";
  row: CrmRow;
  title: string;
  detail: string;
  date: string;
  bucket: "overdue" | "today" | "upcoming" | "unscheduled";
};
export function todayQueue(
  data: CrmData,
  invoices: InvoiceDocSummary[],
  today: string
): TodayItem[] {
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const until = end.toISOString().slice(0, 10),
    result: TodayItem[] = [];
  const add = (
    kind: TodayItem["kind"],
    row: CrmRow,
    title: string,
    detail: string,
    value: unknown
  ) => {
    const date = text(value).slice(0, 10);
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
        date > until)
    )
      return;
    result.push({
      kind,
      row,
      title,
      detail,
      date,
      bucket: !date
        ? "unscheduled"
        : date < today
          ? "overdue"
          : date === today
            ? "today"
            : "upcoming",
    });
  };
  for (const row of data.tasks)
    if (!["done", "cancelled"].includes(text(row.status)))
      add("tasks", row, recordName("tasks", row), linkedName(row, data), row.due_date);
  for (const row of data.activities)
    if (!row.done && row.kind === "meeting")
      add(
        "activities",
        row,
        recordName("activities", row),
        "Meeting · " + linkedName(row, data),
        row.due_date
      );
  const touched = new Set(
    data.activities
      .filter((row) => row.target_type === "lead")
      .map((row) => Number(row.target_id))
  );
  for (const row of data.leads)
    if (
      !["converted", "lost", "unqualified"].includes(text(row.status)) &&
      !touched.has(row.id)
    )
      add("leads", row, recordName("leads", row), "No activity recorded", "");
  for (const invoice of invoices)
    if (
      !["draft", "cancelled", "void", "paid"].includes(invoice.status) &&
      Number(invoice.balance) > 0
    )
      add(
        "invoices",
        invoice as unknown as CrmRow,
        invoice.number,
        `${invoice.customer_name} · Payment follow-up`,
        invoice.due_date
      );
  return result.sort(
    (a, b) =>
      (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title)
  );
}
