import { describe, expect, it } from "vitest";
import { MODULES } from "../../modules/registry";
import { GUIDES } from "../fileyGuides";
import { guideForRoute, validGuideId } from "../guideRoutes";

const settingsSections = [
  "company", "account", "ai", "email", "credits", "teams", "apps", "appearance",
  "preferences", "billing", "devices", "security", "notifications", "backup", "datamode",
] as const;

// Existing documentation links and saved progress use these identifiers.
const existingGuideIds = [
  "remote-agent", "international-business", "directories", "orders", "packing-lists",
  "letters", "receipts", "bank-cheques", "delivery-declarations", "communications",
  "follow-ups", "projects-support", "local-editions", "start", "login", "crm",
  "invoices", "invoice-messages", "quotes", "purchasing", "inventory", "accounting",
  "people", "ai-setup", "agent", "browser", "file-tools", "free-work-tools", "skills",
  "charts", "email", "integrations", "files", "storage",
] as const;

const guideById = (id: string | null) => GUIDES.find(guide => guide.id === id);

describe("Filey guide route coverage", () => {
  it.each(MODULES)("resolves the $id primary route to its own module guide", module => {
    const guide = guideById(guideForRoute(module.to));
    expect(guide, module.to).toBeDefined();
    expect(guide?.moduleId).toBe(module.id);
    expect(guide?.to.split("?")[0]).toBe(module.to);
  });

  it.each(settingsSections)("resolves Settings → %s to the matching setup page", section => {
    const guide = guideById(guideForRoute("/settings", `?section=${section}`));
    expect(guide, section).toBeDefined();
    expect(guide?.moduleId).toBe("settings");
    expect(guide?.to).toBe(`/settings?section=${section}`);
  });

  it("keeps legacy overview and file routes attached to their current section", () => {
    expect(guideForRoute("/overview")).toBe(guideForRoute("/overview-modern"));
    expect(guideForRoute("/my-files")).toBe(guideForRoute("/files"));
    expect(guideById(guideForRoute("/customers/42"))?.moduleId).toBe("customers");
    expect(guideForRoute("/unknown-section")).toBeNull();
    expect(guideForRoute("/constructor")).toBeNull();
    expect(guideForRoute("/settings", "?section=unknown")).toBe("start");
  });
});

describe("Filey guide catalogue safety and completeness", () => {
  it("preserves previous guide links and gives every guide a unique valid identifier", () => {
    const ids = GUIDES.map(guide => guide.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of existingGuideIds) expect(ids, id).toContain(id);
    for (const id of ids) expect(validGuideId(id), id).toBe(true);
  });

  it("only launches existing internal sections with passive tab or section selection", () => {
    const origin = "https://filey.test";
    const routes = new Set(MODULES.map(module => module.to));
    for (const guide of GUIDES) {
      expect(guide.to, guide.id).toMatch(/^\/(?!\/)/);
      expect(guide.to, guide.id).not.toContain("\\");
      expect([...guide.to].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), guide.id).toBe(false);
      const target = new URL(guide.to, origin);
      expect(target.origin, guide.id).toBe(origin);
      expect(target.hash, guide.id).toBe("");
      expect(routes.has(target.pathname), guide.id).toBe(true);
      expect(MODULES.find(module => module.to === target.pathname)?.id, guide.id).toBe(guide.moduleId);
      const keys = [...target.searchParams.keys()];
      expect(new Set(keys).size, guide.id).toBe(keys.length);
      for (const [key, value] of target.searchParams) {
        // No new/create/intent flags: opening an explainer cannot start an action.
        expect(["section", "tab"], guide.id).toContain(key);
        expect(value, guide.id).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("provides readable copy and three to six complete steps per guide", () => {
    for (const guide of GUIDES) {
      for (const value of [guide.category, guide.title, guide.summary, ...guide.steps]) {
        expect(value.trim(), guide.id).not.toBe("");
        expect(value, guide.id).toBe(value.trim());
      }
      expect(guide.steps.length, guide.id).toBeGreaterThanOrEqual(3);
      expect(guide.steps.length, guide.id).toBeLessThanOrEqual(6);
      if (guide.stepTitles) {
        expect(guide.stepTitles.length, guide.id).toBe(guide.steps.length);
        for (const title of guide.stepTitles) expect(title.trim(), guide.id).not.toBe("");
      }
      if (guide.targets) {
        expect(guide.targets.length, guide.id).toBe(guide.steps.length);
        const targets = guide.targets.filter(Boolean);
        expect(new Set(targets).size, guide.id).toBe(targets.length);
        for (const target of targets) expect(target, guide.id).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("keeps the company and invoice pilots aligned with six distinct guide steps", () => {
    for (const id of ["start", "company-details", "invoices"]) {
      const guide = guideById(id)!;
      expect(guide.steps).toHaveLength(6);
      expect(guide.stepTitles).toHaveLength(6);
      expect(guide.targets).toHaveLength(6);
    }
    expect(guideById("company-details")?.targets).toEqual([
      "company-identity", "company-country", "", "", "company-bank", "company-save",
    ]);
    expect(guideById("invoices")?.targets).toEqual([
      "invoice-customer", "invoice-items", "invoice-einvoice", "invoice-preview", "invoice-save", "",
    ]);
  });
});
