import { beforeEach, expect, it } from "vitest";
import { work, crm, setCacheOrg } from "../api";
import { newWorkItem, validateWorkItem, workMinutes } from "../workItems";
import { checkFreeInvoiceCap, canUseLocalMode } from "../license";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("accept_edits");
});

it("persists a customer-linked project, tasks and time; rejects stale edits", async () => {
  const customer = await crm.createCustomer({ name: "Project customer" } as never);
  const input = {
    ...newWorkItem("project"),
    title: "Implement ERP",
    customer_id: customer,
    checklist: [{ id: "task-1", title: "Import products", done: false }],
    time_entries: [
      {
        id: "time-1",
        date: "2026-09-06",
        minutes: 90,
        note: "Discovery",
        person: "Owner",
      },
    ],
  };
  const id = await work.save(input);
  const saved = (await work.list()).find((r) => r.id === id)!;
  expect(saved.customer_id).toBe(customer);
  expect(workMinutes(saved)).toBe(90);
  await work.save(
    { ...saved, status: "active", checklist: [{ ...saved.checklist[0], done: true }] },
    id,
    saved.revision
  );
  await expect(
    work.save({ ...saved, title: "Stale edit" }, id, saved.revision)
  ).rejects.toThrow("record changed");
  const updated = (await work.list()).find((r) => r.id === id)!;
  expect(updated.title).toBe("Implement ERP");
  expect(updated.checklist[0].done).toBe(true);
  await expect(
    work.save({ ...updated, kind: "ticket", status: "open" }, id, updated.revision)
  ).rejects.toThrow();
});

it("rejects bad references, invalid dates, unsafe hours, status and duplicate entries", async () => {
  const valid = { ...newWorkItem("ticket"), title: "Damaged delivery" };
  await expect(work.save({ ...valid, customer_id: 999999 })).rejects.toThrow(
    "unavailable"
  );
  for (const patch of [
    { due_date: "2026-02-30" },
    { status: "completed" },
    { budget_hours: Infinity },
    { customer_id: -1 },
    {
      time_entries: [
        { id: "1", date: "2026-09-06", minutes: -30, note: "", person: "Owner" },
      ],
    },
  ])
    expect(() => validateWorkItem({ ...valid, ...patch })).toThrow();
  expect(() =>
    validateWorkItem({
      ...valid,
      checklist: [
        { id: "1", title: "One", done: false },
        { id: "1", title: "Two", done: false },
      ],
    })
  ).toThrow("Duplicate");
});

it("keeps free local invoices unlimited without querying hosted quotas", async () => {
  expect(await canUseLocalMode()).toBe(true);
  await expect(
    checkFreeInvoiceCap(async () => {
      throw new Error("Must not count local invoices");
    })
  ).resolves.toBeUndefined();
});

it("lets Filey AI create a ticket through the same validation and write gate", async () => {
  const result = await runTool("save_work_item", {
    kind: "ticket",
    values: { title: "Investigate invoice issue", priority: "high" },
  });
  expect(result).toMatchObject({ ok: true, kind: "ticket" });
  expect((await work.list())[0].title).toBe("Investigate invoice issue");
  setAgentMode("plan");
  const blocked = await runTool("save_work_item", {
    kind: "project",
    values: { title: "Should not be written" },
  });
  expect(blocked).not.toMatchObject({ ok: true });
  expect(await work.list()).toHaveLength(1);
});
