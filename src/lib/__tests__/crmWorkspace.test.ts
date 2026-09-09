import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setDataMode } from "../dataMode";
import { crm, persistCrmRecord, importCrmRecords } from "../api";
import { localClient } from "../localdb";
import * as supabaseModule from "../supabase";
import { toCsv, parseCsvObjects } from "../csv";
import {
  emptyCrmData,
  loadCrmData,
  recordDraft,
  saveCrmRecord,
  deleteCrmRecord,
  validateCrmDraft,
  tasksCalendar,
  saveCrmStatus,
  matchesCrmSearch,
  crmExportRows,
  loadCrmRecordContext,
} from "../crmWorkspace";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});
afterEach(() => vi.restoreAllMocks());

it("moves a stale board card without replacing concurrent edits, and reopens tasks correctly", async () => {
  const id = await persistCrmRecord("crm_opportunities", {
    title: "Original",
    value: 200,
    stage: "qualification",
    probability: 20,
  });
  const stale = (await loadCrmData()).deals[0];
  await persistCrmRecord(
    "crm_opportunities",
    { title: "Edited elsewhere", value: 900, owner: "Sam" },
    id
  );
  await saveCrmStatus("deals", stale, "won");
  let latest = (await loadCrmData()).deals[0];
  expect(latest).toMatchObject({
    title: "Edited elsewhere",
    value: 900,
    owner: "Sam",
    stage: "won",
    probability: 100,
  });
  expect(latest.closed_at).toBeTruthy();
  await saveCrmStatus("deals", latest, "proposal");
  latest = (await loadCrmData()).deals[0];
  expect(latest).toMatchObject({ stage: "proposal", probability: 45, closed_at: null });
  const taskId = await persistCrmRecord("crm_tasks", {
    title: "Original task",
    status: "open",
  });
  const task = (await loadCrmData()).tasks[0];
  await persistCrmRecord("crm_tasks", { title: "Revised task" }, taskId);
  await saveCrmStatus("tasks", task, "done");
  const done = (await loadCrmData()).tasks[0];
  expect(done).toMatchObject({ title: "Revised task", status: "done" });
  expect(done.completed_at).toBeTruthy();
  await saveCrmStatus("tasks", done, "open");
  expect((await loadCrmData()).tasks[0]).toMatchObject({
    title: "Revised task",
    status: "open",
    completed_at: null,
  });
});

it("searches linked names and exports optional relationships as importable CSV values", () => {
  const data = emptyCrmData();
  data.companies = [{ id: 11, company: "North Harbour" }];
  data.contacts = [{ id: 12, name: "Sam Jones", company_id: 11 }];
  data.deals = [{ id: 13, title: "Supply agreement", customer_id: 11, person_id: 12 }];
  expect(matchesCrmSearch("contacts", data.contacts[0], data, "harbour")).toBe(true);
  expect(matchesCrmSearch("deals", data.deals[0], data, "SAM JONES")).toBe(true);
  expect(
    matchesCrmSearch(
      "tasks",
      { id: 14, title: "Call", target_type: "deal", target_id: 13 },
      data,
      "supply agreement"
    )
  ).toBe(true);
  expect(matchesCrmSearch("contacts", data.contacts[0], data, "different company")).toBe(
    false
  );
  const rows = [
    { id: 1, title: "Unlinked", status: "open", priority: "normal" },
    {
      id: 2,
      title: "Linked",
      status: "in_progress",
      priority: "high",
      target_type: "company",
      target_id: 11,
    },
  ];
  const csv = parseCsvObjects(toCsv(crmExportRows("tasks", rows)));
  expect(csv.rows.map((row) => row.target)).toEqual(["", "company:11"]);
  expect(csv.rows.map((row) => validateCrmDraft("tasks", row, data))).toEqual([
    expect.objectContaining({ title: "Unlinked", target_type: null, target_id: null }),
    expect.objectContaining({ title: "Linked", target_type: "company", target_id: 11 }),
  ]);
  expect(() =>
    validateCrmDraft(
      "tasks",
      { ...recordDraft("tasks"), title: "Malformed", target: "company:11:extra" },
      data
    )
  ).toThrow("available related record");
  expect(() =>
    validateCrmDraft(
      "leads",
      { ...recordDraft("leads"), name: "Converted", status: "new" },
      data,
      { id: 1, status: "converted" }
    )
  ).toThrow("already converted");
});

it("reads only a record's notes and tasks, including employee context", async () => {
  await persistCrmRecord("crm_notes", {
    body: "Company note",
    target_type: "company",
    target_id: 1,
  });
  await persistCrmRecord("crm_notes", {
    body: "Other company",
    target_type: "company",
    target_id: 2,
  });
  await persistCrmRecord("crm_notes", {
    body: "Employee note",
    target_type: "employee",
    target_id: 1,
  });
  await persistCrmRecord("crm_tasks", {
    title: "Company task",
    target_type: "company",
    target_id: 1,
    status: "open",
  });
  const context = await loadCrmRecordContext("company", 1);
  expect(context.notes.map((note) => note.body)).toEqual(["Company note"]);
  expect(context.tasks.map((task) => task.title)).toEqual(["Company task"]);
  expect(
    (await loadCrmRecordContext("employee", 1)).notes.map((note) => note.body)
  ).toEqual(["Employee note"]);
});

it("paginates cloud record context and rejects a failed later page instead of returning partial notes", async () => {
  setDataMode("cloud");
  const calls: { table: string; cursor: number; target: unknown[] }[] = [];
  let failSecondPage = false;
  const client = {
    from(table: string) {
      let cursor = 0;
      const target: unknown[] = [];
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        eq(column: string, value: unknown) {
          target.push([column, value]);
          return this;
        },
        gt(_column: string, value: number) {
          cursor = value;
          return this;
        },
        then(resolve: (result: unknown) => unknown) {
          calls.push({ table, cursor, target });
          const result =
            table === "crm_tasks"
              ? { data: [], error: null }
              : cursor === 0
                ? {
                    data: Array.from({ length: 500 }, (_, i) => ({ id: i + 1 })),
                    error: null,
                  }
                : failSecondPage
                  ? { data: null, error: { message: "Read denied" } }
                  : { data: [{ id: 501 }], error: null };
          return Promise.resolve(resolve(result));
        },
      };
    },
  };
  const reader = vi
    .spyOn(supabaseModule, "sb")
    .mockReturnValue(client as unknown as ReturnType<typeof supabaseModule.sb>);
  expect((await loadCrmRecordContext("company", 9)).notes).toHaveLength(501);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(
    calls.filter((call) => call.table === "crm_notes").map((call) => call.cursor)
  ).toEqual([0, 500]);
  expect(
    calls.every(
      (call) =>
        JSON.stringify(call.target) ===
        JSON.stringify([
          ["target_type", "company"],
          ["target_id", 9],
        ])
    )
  ).toBe(true);
  failSecondPage = true;
  await expect(loadCrmRecordContext("company", 9)).rejects.toThrow("Notes: Read denied");
});

it("creates, edits and links a complete CRM workflow, with idempotent lead conversion", async () => {
  let data = emptyCrmData();
  const company = await saveCrmRecord(
    "companies",
    {
      ...recordDraft("companies"),
      company: "Example Trading",
      email: "hello@example.test",
    },
    data
  );
  data = await loadCrmData();
  const contact = await saveCrmRecord(
    "contacts",
    { ...recordDraft("contacts"), name: "Sam", company_id: String(company) },
    data
  );
  data = await loadCrmData();
  const deal = await saveCrmRecord(
    "deals",
    {
      ...recordDraft("deals"),
      title: "Office supply",
      customer_id: String(company),
      person_id: String(contact),
      value: "1500",
    },
    data
  );
  data = await loadCrmData();
  expect(data.deals[0]).toMatchObject({
    customer_id: company,
    person_id: contact,
    customer_name: "Example Trading",
    value: 1500,
    probability: 20,
  });
  await saveCrmRecord(
    "deals",
    { ...recordDraft("deals", data.deals[0]), stage: "won" },
    data,
    data.deals[0]
  );
  data = await loadCrmData();
  expect(data.deals[0]).toMatchObject({ stage: "won", probability: 100 });
  expect(data.deals[0].closed_at).toBeTruthy();
  await saveCrmRecord(
    "tasks",
    {
      ...recordDraft("tasks"),
      title: "Call Sam",
      target: `deal:${deal}`,
      due_date: "2026-09-08",
    },
    data
  );
  await saveCrmRecord(
    "notes",
    {
      ...recordDraft("notes"),
      body: "Prefers morning deliveries",
      target: `person:${contact}`,
    },
    data
  );
  data = await loadCrmData();
  await expect(deleteCrmRecord("companies", data.companies[0], data)).rejects.toThrow(
    "linked records"
  );
  await saveCrmRecord(
    "tasks",
    { ...recordDraft("tasks", data.tasks[0]), status: "done" },
    data,
    data.tasks[0]
  );
  expect((await loadCrmData()).tasks[0].completed_at).toBeTruthy();
  const lead = await crm.createLead({
    name: "Alex",
    company: "New business",
    est_value: 400,
  });
  const converted = await Promise.all([crm.convertLead(lead), crm.convertLead(lead)]);
  expect(converted[0]).toBe(converted[1]);
  expect(await crm.convertLead(lead)).toBe(converted[0]);
  data = await loadCrmData();
  expect(data.companies).toHaveLength(2);
  expect(data.contacts).toHaveLength(2);
  expect(data.deals).toHaveLength(2);
  expect(data.leads[0]).toMatchObject({
    status: "converted",
    converted_deal_id: converted[0],
  });
  await expect(
    persistCrmRecord("crm_people", { name: "Ghost" }, 9999)
  ).rejects.toBeTruthy();
  await expect(persistCrmRecord("profiles", { role: "owner" }, 1)).rejects.toThrow(
    "Unsupported CRM"
  );
});

it("validates imports and relationship boundaries before writing", async () => {
  const data = emptyCrmData();
  data.companies = [
    { id: 1, company: "One" },
    { id: 2, company: "Two" },
  ];
  data.contacts = [{ id: 3, name: "Person", company_id: 2 }];
  expect(() =>
    validateCrmDraft(
      "deals",
      { ...recordDraft("deals"), title: "Bad", customer_id: "1", person_id: "3" },
      data
    )
  ).toThrow("selected company");
  expect(() =>
    validateCrmDraft(
      "tasks",
      { ...recordDraft("tasks"), title: "Bad date", due_date: "2026-02-30" },
      data
    )
  ).toThrow("valid due date");
  expect(() =>
    validateCrmDraft(
      "leads",
      { ...recordDraft("leads"), name: "Lead", est_value: "NaN" },
      data
    )
  ).toThrow("allowed range");
  expect(() =>
    validateCrmDraft(
      "notes",
      { ...recordDraft("notes"), body: "Orphan", target: "company:999" },
      data
    )
  ).toThrow("available related record");
  const patches = ["One", "Two"].map((name) =>
    validateCrmDraft("leads", { ...recordDraft("leads"), name }, data)
  );
  await importCrmRecords("crm_leads", patches);
  expect((await localClient.from("crm_leads").select()).data).toHaveLength(2);
});

it("exports calendar dates without timezone shifts or injected calendar properties", () => {
  const calendar = tasksCalendar(
    [
      {
        id: 1,
        title: "Call, Sam\r\nEND:VEVENT",
        body: "مرحبا".repeat(30),
        due_date: "2026-12-31",
        status: "open",
      },
      { id: 2, title: "Closed", due_date: "2026-09-08", status: "cancelled" },
      { id: 3, title: "Bad date", due_date: "2026-02-30", status: "open" },
    ],
    new Date("2026-09-06T00:00:00Z")
  );
  expect(calendar).toContain("DTEND;VALUE=DATE:20270101");
  expect(calendar).toContain("SUMMARY:Call\\, Sam\\nEND:VEVENT");
  expect(calendar.match(/\r\nEND:VEVENT\r\n/g)).toHaveLength(1);
  expect(
    calendar.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)
  ).toBe(true);
});
