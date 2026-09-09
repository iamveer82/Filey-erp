import { expect, it } from "vitest";
import { emptyCrmData } from "../../lib/crmWorkspace";
import { crmSortValue, matchesDueFilter } from "./viewOptions";

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
