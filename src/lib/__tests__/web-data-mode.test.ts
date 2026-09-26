import { beforeEach, expect, it, vi } from "vitest";
import { localClient } from "../localdb";
import {
  adoptLegacyCustomTemplates,
  hasUnscopedCustomTemplates,
  loadCustomTemplates,
  saveCustomTemplate,
  syncCustomTemplates,
} from "../customTemplates";
import { setCacheOrg } from "../api";
import { effectiveDataMode, getDataMode, setImplicitDataMode } from "../dataMode";
import type { CustomTemplate } from "../../components/TemplateDesigner";

vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return {
    sb: vi.fn(() => localClient),
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "web-user" } } }, error: null }) } },
  };
});

const template = (id = "one"): CustomTemplate => ({
  id: `custom-${id}`, name: id, type: "builder", layout: "minimal", accent: "#222",
  font: "sans-serif", paperSize: "A4", showLogo: true, showSeller: true, showCustomer: true,
  showNotes: true, showTerms: true, showTax: true,
});

beforeEach(() => {
  localStorage.clear();
  setImplicitDataMode(null);
  setCacheOrg("org-uuid", "web-user");
  // filey_data_mode is deliberately NOT set: the hosted web build never shows
  // the storage picker, so production has no stored mode. See App.tsx.
});

// The regression: a signed-in web user was told to "sign in to this workspace"
// because the scope was built from the unpersisted mode and came out null.
it("loads templates for a signed-in web user even though the mode was never persisted", async () => {
  await localClient.from("app_settings").insert({
    key: "custom_templates:org-uuid", value: JSON.stringify([template()]),
    user_id: "web-user", org_id: "org-uuid",
  });
  await expect(syncCustomTemplates()).resolves.toEqual([template()]);
  expect(loadCustomTemplates()).toEqual([template()]);
});

it("saves templates for a signed-in web user with no stored mode", async () => {
  await expect(saveCustomTemplate(template("saved"))).resolves.toEqual([template("saved")]);
  const row = await localClient.from("app_settings").select("key,value,user_id,org_id").single();
  expect(row.data).toMatchObject({ key: "custom_templates:org-uuid", user_id: "web-user", org_id: "org-uuid" });
});

it("treats an absent mode as the store the build actually talks to", () => {
  setImplicitDataMode("cloud");
  expect(getDataMode()).toBeNull();
  expect(effectiveDataMode()).toBe("cloud");
  setImplicitDataMode("local");
  expect(effectiveDataMode()).toBe("local");
});

it("still demands an account, and says which one, when nobody is signed in", async () => {
  setImplicitDataMode("cloud");
  setCacheOrg(null);
  await expect(syncCustomTemplates()).rejects.toThrow("Sign in to your Filey account");
  await expect(syncCustomTemplates()).rejects.not.toThrow(/workspace/i);
});

// Templates saved before per-account scoping are the user's only copy on a
// device workspace; leaving them unreachable reads as data loss.
it("restores the pre-account template cache into the signed-in device account", async () => {
  setImplicitDataMode("local");
  localStorage.setItem("filey.customTemplates", JSON.stringify([template("old"), template("older")]));
  expect(hasUnscopedCustomTemplates()).toBe(true);
  expect(loadCustomTemplates()).toEqual([]);

  await expect(adoptLegacyCustomTemplates()).resolves.toEqual([template("old"), template("older")]);
  expect(loadCustomTemplates().map((t) => t.name)).toEqual(["old", "older"]);
  expect(hasUnscopedCustomTemplates()).toBe(false);
});

it("keeps the legacy cache when it cannot be read", async () => {
  setImplicitDataMode("local");
  localStorage.setItem("filey.customTemplates", "{not json");
  expect(hasUnscopedCustomTemplates()).toBe(true);
  await expect(adoptLegacyCustomTemplates()).rejects.toThrow("original data has been preserved");
  expect(localStorage.getItem("filey.customTemplates")).toBe("{not json");
});

it("leaves an already-scoped template alone when adopting", async () => {
  setImplicitDataMode("local");
  await saveCustomTemplate({ ...template("same"), name: "renamed" });
  localStorage.setItem("filey.customTemplates", JSON.stringify([template("same"), template("new")]));
  await expect(adoptLegacyCustomTemplates()).resolves.toEqual([
    { ...template("same"), name: "renamed" },
    template("new"),
  ]);
});
