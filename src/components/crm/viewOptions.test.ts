import { expect, it } from "vitest";
import { emptyCrmData } from "../../lib/crmWorkspace";
import { crmSortValue, matchesDueFilter, withRelationshipCounts } from "./viewOptions";

it("filters incomplete tasks by calendar day without losing month boundaries", () => {
  const row = { id: 1, status: "open", due_date: "2026-09-01T15:00:00Z" };
  expect(matchesDueFilter(row, "week", "2026-08-29")).toBe(true);
  expect(matchesDueFilter({ ...row, due_date: "2026-09-05" }, "week", "2026-08-29")).toBe(
    false
  );
  expect(matchesDueFilter(row, "today", "2026-09-01")).toBe(true);
  expect(matchesDueFilter(row, "overdue", "2026-09-01")).toBe(false);
  expect(matchesDueFilter(row, "overdue", "2026-09-02")).toBe(true);
  expect(matchesDueFilter({ ...row, status: "done" }, "today", "2026-09-01")).toBe(false);
  expect(matchesDueFilter({ ...row, due_date: null }, "unscheduled", "2026-09-01")).toBe(
    true
  );
});

it("derives relationship counts from current records without mutating them or counting closed deals", () => {
  const data = emptyCrmData();
  data.companies = [
    { id: 1, company: "North" },
    { id: 2, company: "South" },
  ];
  data.contacts = [{ id: 4, name: "Sam", company_id: 1 }];
  data.deals = [
    { id: 6, customer_id: 1, person_id: 4, stage: "proposal" },
    { id: 7, customer_id: 1, person_id: 4, stage: "won" },
    { id: 8, customer_id: 2, stage: "lost" },
  ];
  const before = JSON.stringify(data);
  expect(withRelationshipCounts("companies", data)).toEqual([
    expect.objectContaining({ id: 1, contact_count: 1, open_deal_count: 1 }),
    expect.objectContaining({ id: 2, contact_count: 0, open_deal_count: 0 }),
  ]);
  expect(withRelationshipCounts("contacts", data)[0].open_deal_count).toBe(1);
  expect(JSON.stringify(data)).toBe(before);
});

it("sorts relationships by the visible name rather than numeric IDs", () => {
  const data = emptyCrmData();
  data.companies = [
    { id: 99, company: "Alpha" },
    { id: 1, company: "Zulu" },
  ];
  expect(crmSortValue("contacts", { id: 2, company_id: 99 }, "company_id", data)).toBe(
    "alpha"
  );
  expect(crmSortValue("contacts", { id: 3, company_id: 1 }, "company_id", data)).toBe(
    "zulu"
  );
  expect(
    crmSortValue(
      "tasks",
      { id: 4, target_type: "company", target_id: 99 },
      "target",
      data
    )
  ).toBe("alpha");
});
