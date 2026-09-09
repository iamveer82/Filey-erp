import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { localClient } from "../localdb";
import { deleteCustomTemplate, loadCustomTemplates, saveCustomTemplate, syncCustomTemplates } from "../customTemplates";
import type { CustomTemplate } from "../../components/TemplateDesigner";
import { sb } from "../supabase";

const identity = vi.hoisted(() => ({ scope: null as string | null, userId: "", count: 0 }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { sb: vi.fn(() => localClient), supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: identity.userId } } }, error: null }) } } };
});

const template = (id = "one"): CustomTemplate => ({
  id: `custom-${id}`, name: id, type: "builder", layout: "minimal", accent: "#222", font: "sans-serif", paperSize: "A4",
  showLogo: true, showSeller: true, showCustomer: true, showNotes: true, showTerms: true, showTax: true,
});
const cloud = (user = identity.userId, org = "org") => { localStorage.setItem("filey_data_mode", "cloud"); identity.userId = user; identity.scope = `${org}:user:${user}`; };
const seed = async (items: CustomTemplate[], extra = {}) => {
  const { data, error } = await localClient.from("app_settings").insert({ key: "custom_templates", value: JSON.stringify(items), ...extra }).select("id").single();
  if (error) throw error;
  return data.id as number;
};
beforeEach(() => {
  localStorage.clear();
  identity.userId = `account-${++identity.count}`;
  identity.scope = `org:user:${identity.userId}`;
  localStorage.setItem("filey_data_mode", "local");
});
afterEach(() => vi.restoreAllMocks());

it("reads existing local settings without changing or exposing the unowned legacy cache", async () => {
  const legacy = JSON.stringify([template("unknown-owner")]);
  localStorage.setItem("filey.customTemplates", legacy);
  expect(loadCustomTemplates()).toEqual([]);
  expect(await syncCustomTemplates()).toEqual([]);
  expect(localStorage.getItem("localdb:app_settings")).toBeNull();
  await seed([template("local-owner")]);
  const original = localStorage.getItem("localdb:app_settings");
  expect(await syncCustomTemplates()).toEqual([template("local-owner")]);
  expect(localStorage.getItem("localdb:app_settings")).toBe(original);
  expect(localStorage.getItem("filey.customTemplates")).toBe(legacy);
});

it("separates local, cloud accounts and organizations and never uses a signed-out cache", async () => {
  await seed([template("local")]);
  await syncCustomTemplates();
  cloud();
  expect(loadCustomTemplates()).toEqual([]);
  await seed([template("cloud-a")], { user_id: identity.userId, org_id: "org" });
  expect(await syncCustomTemplates()).toEqual([template("cloud-a")]);
  cloud(identity.userId, "other-org");
  expect(loadCustomTemplates()).toEqual([]);
  expect(await syncCustomTemplates()).toEqual([]);
  await saveCustomTemplate(template("other-org"));
  const saved = await localClient.from("app_settings").select("key").eq("org_id", "other-org").single();
  expect(saved.data.key).toBe("custom_templates:other-org");
  cloud(identity.userId);
  expect(await syncCustomTemplates()).toEqual([template("cloud-a")]);
  cloud("different-account");
  expect(loadCustomTemplates()).toEqual([]);
  expect(await syncCustomTemplates()).toEqual([]);
  identity.scope = null;
  expect(loadCustomTemplates()).toEqual([]);
  await expect(syncCustomTemplates()).rejects.toThrow("Sign in");
  await expect(saveCustomTemplate(template())).rejects.toThrow("Sign in");
});

it("awaits cloud writes and retains the confirmed snapshot if persistence fails", async () => {
  cloud();
  await seed([template()], { user_id: identity.userId, org_id: "org" });
  await syncCustomTemplates();
  const original = localStorage.getItem("localdb:app_settings");
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:app_settings") throw new Error("Storage rejected");
    setItem.call(this, key, value);
  });
  await expect(saveCustomTemplate(template("unsaved"))).rejects.toThrow();
  await expect(deleteCustomTemplate(template().id)).rejects.toThrow();
  expect(loadCustomTemplates()).toEqual([template()]);
  expect(localStorage.getItem("localdb:app_settings")).toBe(original);
});

it("does not reinterpret failed or malformed reads as an empty list to overwrite", async () => {
  cloud();
  await seed([template()], { user_id: identity.userId, org_id: "org" });
  await syncCustomTemplates();
  vi.mocked(sb).mockImplementationOnce(() => { throw new Error("Cloud unavailable"); });
  await expect(syncCustomTemplates()).rejects.toThrow("Cloud unavailable");
  expect(loadCustomTemplates()).toEqual([]);
  await localClient.from("app_settings").update({ value: "unreadable-original" }).eq("key", "custom_templates");
  await expect(saveCustomTemplate(template("replacement"))).rejects.toThrow("original data has been preserved");
  expect((await localClient.from("app_settings").select("value").single()).data.value).toBe("unreadable-original");
});

it("rejects a save from a designer opened in a different workspace", async () => {
  const originalScope = `local:${identity.scope}`;
  cloud();
  await expect(saveCustomTemplate(template(), originalScope)).rejects.toThrow("workspace changed");
  expect(localStorage.getItem("localdb:app_settings")).toBeNull();
});

it("serializes same-window edits against fresh rows and preserves existing templates", async () => {
  cloud();
  await seed([template()], { user_id: identity.userId, org_id: "org" });
  await Promise.all([saveCustomTemplate(template("two")), saveCustomTemplate(template("three"))]);
  expect(loadCustomTemplates().map((item) => item.name)).toEqual(["one", "two", "three"]);
  await deleteCustomTemplate("custom-two");
  expect((await syncCustomTemplates()).map((item) => item.name)).toEqual(["one", "three"]);
});

it("rejects an update when another window changes the list after its read", async () => {
  cloud();
  await seed([template()], { user_id: identity.userId, org_id: "org" });
  const from = localClient.from.bind(localClient);
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table);
    const update = query.update.bind(query);
    vi.spyOn(query, "update").mockImplementation((value) => {
      const rows = JSON.parse(localStorage.getItem("localdb:app_settings")!);
      rows[0].value = JSON.stringify([template("other-window")]);
      localStorage.setItem("localdb:app_settings", JSON.stringify(rows));
      return update(value);
    });
    return query;
  });
  await expect(saveCustomTemplate(template("this-window"))).rejects.toThrow("another window");
  expect(JSON.parse(localStorage.getItem("localdb:app_settings")!)[0].value).toBe(JSON.stringify([template("other-window")]));
});

it("discards a late cloud response after switching accounts", async () => {
  cloud();
  let finish!: (value: { data: { id: number; value: string }; error: null }) => void;
  const response = new Promise<{ data: { id: number; value: string }; error: null }>((resolve) => { finish = resolve; });
  const from = localClient.from.bind(localClient);
  const query = from("app_settings");
  const read = vi.spyOn(query, "maybeSingle").mockImplementation(() => response as never);
  vi.spyOn(localClient, "from").mockReturnValueOnce(query);
  const pending = syncCustomTemplates();
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  cloud("next-account");
  finish({ data: { id: 1, value: JSON.stringify([template("previous-account")]) }, error: null });
  await expect(pending).rejects.toThrow("workspace changed");
  expect(loadCustomTemplates()).toEqual([]);
});
