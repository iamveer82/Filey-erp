import { beforeEach, describe, expect, it } from "vitest";
import {
  deletePipelineView,
  listPipelineViews,
  matchesView,
  savePipelineView,
} from "../pipelineViews";

// A saved view stores only its filter, so it must stay honest as deals come and
// go: matching is a pure predicate over the row, never over stored ids.
beforeEach(() => {
  localStorage.clear();
});

describe("pipelineViews", () => {
  it("saves, upserts by name (case-insensitive), and deletes", () => {
    savePipelineView({ name: "Ahmed's deals", owner: "Ahmed" });
    savePipelineView({ name: "ahmed's deals", owner: "Fatima" });
    let views = listPipelineViews();
    expect(views).toHaveLength(1);
    expect(views[0].owner).toBe("Fatima");

    savePipelineView({ name: "Big deals", stage: "proposal" });
    views = listPipelineViews();
    expect(views).toHaveLength(2);

    deletePipelineView("AHMED'S DEALS");
    expect(listPipelineViews().map((v) => v.name)).toEqual(["Big deals"]);
  });

  it("refuses to save an unnamed view", () => {
    expect(() => savePipelineView({ name: "   " })).toThrow(/name/i);
  });

  it("matches on query across title and customer name", () => {
    const deal = {
      title: "Fit-out for Acme",
      customer_name: "Globex Trading",
      owner: "Ahmed",
      stage: "proposal",
    };
    expect(matchesView(deal, { query: "acme" })).toBe(true);
    expect(matchesView(deal, { query: "globex" })).toBe(true);
    expect(matchesView(deal, { query: "nope" })).toBe(false);
  });

  it("filters by exact owner and stage; empty filters match everything", () => {
    const deal = { title: "T", customer_name: "C", owner: "Ahmed", stage: "won" };
    expect(matchesView(deal, { owner: "Ahmed" })).toBe(true);
    expect(matchesView(deal, { owner: "Fatima" })).toBe(false);
    // A deal with no owner is only hidden when an owner filter is set.
    expect(matchesView({ ...deal, owner: undefined }, { owner: "" })).toBe(true);
    expect(matchesView(deal, { stage: "proposal" })).toBe(false);
    expect(matchesView(deal, {})).toBe(true);
  });
});
