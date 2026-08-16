import { describe, expect, it } from "vitest";
import { TOOLS } from "../aiTools";
import { CORE_TOOLS, TOOLSETS, setOf, toolsetIndex } from "../toolsets";

// The map is hand-kept, so this is what stops it drifting: a tool added to
// TOOLS without being placed is a tool the agent can never reach.
describe("toolsets cover the tool list exactly", () => {
  const placed = new Set<string>([
    ...CORE_TOOLS,
    ...Object.values(TOOLSETS).flatMap((s) => s.tools),
  ]);
  // list_toolsets/use_toolset are added by the harness, not in TOOLS.
  const harnessOwned = new Set(["list_toolsets", "use_toolset"]);
  const real = new Set(TOOLS.map((t) => t.name));

  it("places every real tool", () => {
    const missing = [...real].filter((n) => !placed.has(n));
    expect(missing).toEqual([]);
  });

  it("names no tool that does not exist", () => {
    const phantom = [...placed].filter((n) => !real.has(n) && !harnessOwned.has(n));
    expect(phantom).toEqual([]);
  });

  it("places each tool once", () => {
    const all = [...CORE_TOOLS, ...Object.values(TOOLSETS).flatMap((s) => s.tools)];
    const dupes = all.filter((n, i) => all.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("keeps the core set small enough to be worth having", () => {
    // The whole point is a short list. If this fails, move something out
    // rather than raising the number.
    expect(CORE_TOOLS.length).toBeLessThanOrEqual(25);
    expect(CORE_TOOLS.length * 3).toBeLessThan(real.size);
  });
});

describe("lookup helpers", () => {
  it("reports the owning set, and empty for core", () => {
    expect(setOf("create_invoice_draft")).toBe("");
    expect(setOf("run_payroll")).toBe("people");
    expect(setOf("run_shell")).toBe("system");
    expect(setOf("no_such_tool")).toBe("");
  });

  it("indexes every set with a description", () => {
    const idx = toolsetIndex();
    expect(idx.length).toBe(Object.keys(TOOLSETS).length);
    expect(idx.every((s) => s.about.length > 10 && s.tools > 0)).toBe(true);
  });
});
