import { expect, it } from "vitest";
import { emptyCrmData } from "../../lib/crmWorkspace";
import type { InvoiceDocSummary } from "../../lib/api";
import { todayQueue } from "./todayQueue";

it("combines actionable work without treating drafts, paid invoices or completed tasks as overdue", () => {
  const data = emptyCrmData();
  data.tasks = [
    { id: 1, title: "Call", status: "open", due_date: "2026-09-11" },
    { id: 2, title: "Done", status: "done", due_date: "2026-09-11" },
    { id: 3, title: "Later", status: "open", due_date: "2026-09-19" },
    { id: 4, title: "Invalid", status: "open", due_date: "2026-02-31" },
  ];
  data.leads = [
    { id: 1, name: "New lead", status: "new" },
    { id: 2, name: "Known lead", status: "contacted" },
    { id: 3, status: "converted" },
  ];
  data.activities = [
    { id: 1, target_type: "lead", target_id: 2, kind: "call" },
    { id: 2, kind: "meeting", subject: "Review", due_date: "2026-09-18", done: false },
  ];
  const invoices = ["sent", "draft", "paid", "cancelled"].map((status, index) => ({
    id: index + 1,
    number: `INV-${index}`,
    status,
    balance: 50,
    due_date: "2026-09-12",
  })) as InvoiceDocSummary[];
  expect(
    todayQueue(data, invoices, "2026-09-12").map((item) => [
      item.kind,
      item.row.id,
      item.bucket,
    ])
  ).toEqual([
    ["tasks", 1, "overdue"],
    ["invoices", 1, "today"],
    ["activities", 2, "upcoming"],
    ["leads", 1, "unscheduled"],
  ]);
});
