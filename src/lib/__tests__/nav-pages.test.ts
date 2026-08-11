import { describe, it, expect } from "vitest";
import { TOOLS } from "../aiTools";
import { MODULES } from "../../modules/registry";

/* The agent navigates by page name. That list was hand-maintained and had
 * fallen to 14 of the app's 28 modules, so asking it to open the cheque
 * register or the payment receipts got "unknown page" — half the product was
 * unreachable. Adding a module to the registry without exposing it here should
 * fail loudly rather than quietly shrink what the agent can reach. */

/** Page names the open_page tool accepts, read out of its own description. */
function navPages(): string[] {
  const tool = TOOLS.find((t) => t.name === "open_page");
  if (!tool) throw new Error("open_page tool is missing");
  const m = tool.description.match(/Pages: ([^.]+)\./);
  if (!m) throw new Error("open_page no longer lists its pages");
  return m[1].split(",").map((s) => s.trim());
}

describe("agent navigation", () => {
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
