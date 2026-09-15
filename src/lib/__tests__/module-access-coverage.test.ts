import { describe, expect, it } from "vitest";
import { TOOLS } from "../aiTools";
import { moduleToolPlacement } from "../moduleAccess";

// The module gate refuses a tool it cannot place, so an unplaced tool is a
// tool that stops working for restricted members the day it ships. Catch it
// here instead of in someone's workspace.
describe("module permissions cover the tool list", () => {
  it("places every tool in a module, or deliberately outside one", () => {
    const unplaced = TOOLS.map((t) => t.name).filter((name) => !moduleToolPlacement(name));
    expect(unplaced).toEqual([]);
  });
});
