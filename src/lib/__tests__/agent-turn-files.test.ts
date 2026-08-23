// Per-turn file-toolbox state. The attachment and produced files used to be
// two module globals shared by every chat surface, so the popover and the
// full-page agent — mounted at the same time, both mid-run — clobbered each
// other's files and drained outputs under the wrong reply.
import { describe, expect, it } from "vitest";
import { setTurnFile, endTurn } from "../aiTools";

const file = (name: string) => new File(["x"], name, { type: "text/plain" });

describe("turn-scoped file state", () => {
  it("keeps each turn's outputs separate", () => {
    setTurnFile("t1", file("a.txt"));
    setTurnFile("t2", file("b.txt"));

    // Ending one turn must not touch the other's slot.
    const t2 = endTurn("t2");
    expect(t2.map((f) => f.name)).toEqual([]);
    const t1 = endTurn("t1");
    expect(t1.map((f) => f.name)).toEqual([]);
  });

  it("endTurn drains exactly once", () => {
    setTurnFile("t3", null);
    expect(endTurn("t3")).toEqual([]);
    // Second drain of an ended turn is empty, never another turn's files.
    setTurnFile("t4", file("c.txt"));
    expect(endTurn("t4")).toEqual([]);
    expect(endTurn("t4")).toEqual([]);
  });

  it("clearing the file reaps an empty slot", () => {
    setTurnFile("t5", file("d.txt"));
    setTurnFile("t5", null); // cleared before producing anything
    expect(endTurn("t5")).toEqual([]);
  });
});
