import { beforeEach, describe, expect, it } from "vitest";
import { offeredTools } from "../agentHarness";
import { TOOLS } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { setCapabilityEnabled } from "../capabilities";
import { TOOLSETS } from "../toolsets";

beforeEach(() => localStorage.clear());

const names = (opened: string[] = [], opts = {}) =>
  offeredTools({ isOwner: true, ...opts }, new Set(opened)).map((t) => t.name);

describe("what the model is offered", () => {
  it("is a fraction of the full tool list", () => {
    const offered = names();
    // The whole point: 89 near-neighbours is past where a model picks well.
    expect(offered.length).toBeLessThan(TOOLS.length / 2);
    expect(offered).toContain("create_invoice_draft");
    expect(offered).toContain("list_toolsets");
  });

  it("keeps specialist tools back until asked for", () => {
    expect(names()).not.toContain("run_payroll");
    expect(names(["people"])).toContain("run_payroll");
  });

  it("stops advertising domains once they are all open", () => {
    // Derived from TOOLSETS rather than hand-listed: a hardcoded copy fails
    // whenever a domain is added, which says nothing about the behaviour under
    // test and trains people to edit the list until it goes green.
    expect(names(Object.keys(TOOLSETS))).not.toContain("use_toolset");
  });
});

describe("gates apply to what is offered, not just to what runs", () => {
  it("Plan mode offers no tool that changes anything", () => {
    setAgentMode("plan");
    const offered = names(["sales", "purchasing", "inventory"]);
    for (const w of [
      "create_invoice_draft",
      "send_invoice",
      "adjust_stock",
      "create_purchase_order",
    ]) {
      expect(offered).not.toContain(w);
    }
    expect(offered).toContain("get_stats"); // reading is still free
  });

  it("a disabled capability disappears instead of refusing a round", () => {
    setAgentMode("auto");
    expect(names(["messaging"])).toContain("send_gmail");
    setCapabilityEnabled("channels", false);
    expect(names(["messaging"])).not.toContain("send_gmail");
  });

  it("owner-only tools are never shown to a non-owner", () => {
    setAgentMode("auto");
    const asCustomer = names(["system"], { isOwner: false });
    expect(asCustomer).not.toContain("run_shell");
    expect(names(["system"])).toContain("run_shell");
  });
});

describe("the payload actually shrinks", () => {
  it("cuts the tool-schema bytes by most of the list", () => {
    setAgentMode("auto");
    const bytesOf = (list: { name: string; description: string; parameters: unknown }[]) =>
      JSON.stringify(list).length;
    const before = bytesOf(
      TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    );
    const after = bytesOf(offeredTools({ isOwner: true }, new Set()));
    console.info(
      `tool payload: ${before} → ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller)`
    );
    expect(after).toBeLessThan(before * 0.5);
  });
});
