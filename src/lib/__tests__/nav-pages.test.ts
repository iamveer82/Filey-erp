import { describe, it, expect } from "vitest";
import { TOOLS } from "../aiTools";
import { MODULES } from "../../modules/registry";
import { validateToolArgs } from "../agentToolSchema";

/* The agent navigates by page name. That list was hand-maintained and had
 * fallen to 14 of the app's 28 modules, so asking it to open the cheque
 * register or the payment receipts got "unknown page" — half the product was
 * unreachable. Adding a module to the registry without exposing it here should
 * fail loudly rather than quietly shrink what the agent can reach. */

/** Page names accepted by the same schema advertised to the model. */
function navPages(): string[] {
  const tool = TOOLS.find((t) => t.name === "open_page");
  if (!tool) throw new Error("open_page tool is missing");
  const properties = tool.parameters.properties as { page?: { enum?: unknown } } | undefined;
  const pages = properties?.page?.enum;
  if (!Array.isArray(pages) || pages.some((page) => typeof page !== "string"))
    throw new Error("open_page no longer enumerates its accepted pages");
  return pages;
}

describe("agent navigation", () => {
  it("advertises the accepted pages in its schema and opens the registered Letters route", async () => {
    const tool = TOOLS.find((t) => t.name === "open_page")!;
    expect(tool.parameters).toMatchObject({ properties: { page: { enum: navPages() } } });
    expect(validateToolArgs(tool.parameters, { page: "letters" })).toBeNull();
    expect(validateToolArgs(tool.parameters, { page: "unknown-section" })).toBeTruthy();
    const hash = window.location.hash;
    try {
      await expect(tool.run({ page: "letters" })).resolves.toEqual({ ok: true, message: "Opened letters." });
      expect(window.location.hash).toBe(`#${MODULES.find((module) => module.id === "letters")!.to}`);
    } finally { window.location.hash = hash; }
  });

  it("can reach every module in the app", () => {
    const pages = new Set(navPages());
    const missing = MODULES.map((m) => m.to.replace(/^\//, ""))
      // The agent already runs on its own page, and the overview is reachable
      // through its /overview alias rather than the registry's route.
      .filter((p) => p !== "agent" && p !== "overview-modern")
      .filter((p) => !pages.has(p));
    expect(missing).toEqual([]);
  });

  it("offers no page the router cannot serve", () => {
    const known = new Set([
      ...MODULES.map((m) => m.to.replace(/^\//, "")),
      "overview", // legacy alias kept in App.tsx
    ]);
    expect(navPages().filter((p) => !known.has(p))).toEqual([]);
  });
});
