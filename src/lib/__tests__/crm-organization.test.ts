import { beforeEach, expect, it } from "vitest";
import { setCacheOrg, tools } from "../api";
import { localClient } from "../localdb";
import { bulkUpdateCrm, crmDuplicates } from "../crmOrganization";
import { emptyCrmData, recordDraft, saveCrmRecord, type CrmRow } from "../crmWorkspace";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test", "owner");
});
it("flags exact identifiers without assuming people with the same name are duplicates", () => {
  expect(
    crmDuplicates("contacts", [
      { id: 1, name: "Sam", email: " SAM@example.com ", phone: "+971 50 1234567" },
      { id: 2, name: "Different", email: "sam@example.com", phone: "971501234567" },
      { id: 3, name: "Sam" },
    ])
  ).toEqual([
    { reason: "Same email", ids: [1, 2] },
    { reason: "Same phone", ids: [1, 2] },
  ]);
});
it("bulk updates one field, reports stale records and preserves unrelated edits", async () => {
  const data = emptyCrmData();
  await localClient.from("crm_tasks").insert([
    { id: 1, title: "A", status: "open", priority: "normal" },
    { id: 2, title: "B", status: "open", priority: "normal" },
  ]);
  data.tasks = (await localClient.from("crm_tasks").select()).data as CrmRow[];
  const snapshot = structuredClone(data.tasks);
  await localClient
    .from("crm_tasks")
    .update({ title: "Someone else's change", updated_at: "2026-09-12T12:00:00Z" })
    .eq("id", 2);
  const result = await bulkUpdateCrm("tasks", snapshot, "assignee", "Sam", data);
  expect(result.updated).toEqual([1]);
  expect(result.failed.map((item) => item.row.id)).toEqual([2]);
  const saved = (await localClient.from("crm_tasks").select()).data as CrmRow[];
  expect(saved[0]).toMatchObject({ title: "A", assignee: "Sam", status: "open" });
  expect(saved[1].title).toBe("Someone else's change");
  expect(saved[1].assignee).toBeUndefined();
  await expect(bulkUpdateCrm("tasks", snapshot, "org_id", "other", data)).rejects.toThrow(
    "available field"
  );
});
it("saves validated custom values while preserving fields whose definitions were removed", async () => {
  await tools.setSetting(
    "custom_fields_contacts",
    JSON.stringify([
      {
        id: "cf1",
        module: "contacts",
        key: "region",
        label: "Region",
        type: "text",
        required: true,
        position: 0,
        createdAt: "2026-09-12",
      },
    ])
  );
  await localClient
    .from("crm_people")
    .insert({ id: 1, name: "Sam", custom_fields: { legacy: "keep" } });
  const data = emptyCrmData();
  data.contacts = (await localClient.from("crm_people").select()).data as CrmRow[];
  const row = data.contacts[0],
    draft = recordDraft("contacts", row);
  await expect(
    saveCrmRecord(
      "contacts",
      { ...draft, custom_fields: JSON.stringify({ region: "" }) },
      data,
      row
    )
  ).rejects.toThrow("Region is required");
  await saveCrmRecord(
    "contacts",
    { ...draft, custom_fields: JSON.stringify({ region: "North" }) },
    data,
    row
  );
  expect(
    (await localClient.from("crm_people").select().eq("id", 1).single()).data
      .custom_fields
  ).toEqual({ region: "North", legacy: "keep" });
});
