import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ scope: "org:user:alice", settings: vi.fn(), save: vi.fn() }));
vi.mock("../api", () => ({ getCacheScope: () => state.scope, tools: { settings: state.settings, setSetting: state.save } }));
import { listCustomFields, saveCustomFields, syncCustomFields, validateCustomValue, type CustomFieldDef } from "../customFields";
const field: CustomFieldDef = { id: "field1", module: "customers", key: "region", label: "Region", type: "text", position: 0, createdAt: "2026-09-12" };
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); state.scope = "org:user:alice"; state.settings.mockReset().mockResolvedValue([]); state.save.mockReset().mockResolvedValue(undefined); });
it("isolates definitions across accounts and storage modes without adopting anonymous legacy data", async () => {
  localStorage.setItem("filey.custom_fields.customers", JSON.stringify([field]));
  expect(listCustomFields("customers")).toEqual([]);
  await saveCustomFields("customers", [field]);
  expect(listCustomFields("customers")).toEqual([field]);
  state.scope = "org:user:bob"; expect(listCustomFields("customers")).toEqual([]);
  state.scope = "org:user:alice"; localStorage.setItem("filey_data_mode", "cloud"); expect(listCustomFields("customers")).toEqual([]);
  expect(localStorage.getItem("filey.custom_fields.customers")).toContain("Region");
});
it("requires an acknowledged save and preserves the previous cache on failure", async () => {
  await saveCustomFields("customers", [field]);
  state.save.mockRejectedValueOnce(new Error("Save failed"));
  await expect(saveCustomFields("customers", [])).rejects.toThrow("Save failed");
  expect(listCustomFields("customers")).toEqual([field]);
});
it("rejects a late load after switching accounts", async () => {
  let finish!: (value: unknown) => void;
  state.settings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = syncCustomFields("customers");
  state.scope = "org:user:bob";
  finish([{ key: "custom_fields_customers", value: JSON.stringify([field]) }]);
  await expect(pending).rejects.toThrow("account changed");
  expect(listCustomFields("customers")).toEqual([]);
});
it("loads canonical definitions and clears an obsolete scoped cache when the setting is absent", async () => {
  await saveCustomFields("customers", [field]);
  expect(await syncCustomFields("customers")).toEqual([]);
  expect(listCustomFields("customers")).toEqual([]);
});
it("rejects unsafe field keys, non-finite numbers, missing consent checkboxes and unsafe URLs", async () => {
  await expect(saveCustomFields("customers", [{ ...field, key: "constructor" }])).rejects.toThrow("valid unique key");
  expect(state.save).not.toHaveBeenCalled();
  expect(validateCustomValue({ ...field, type: "number" }, "Infinity")).toContain("number");
  expect(validateCustomValue({ ...field, type: "checkbox", required: true }, false)).toContain("required");
  expect(validateCustomValue({ ...field, type: "url" }, "javascript:alert(1)")).toContain("http");
});
