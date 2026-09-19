import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const cloud = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../supabase", () => ({
  isConfigured: true, supabase: null,
  sb: () => ({ from: () => {
    let writing = false;
    const q = {
      select: () => q, single: () => q, order: () => q, range: () => q, eq: () => q,
      update: () => { writing = true; return q; },
      then: (resolve: (value: unknown) => unknown) => (writing ? cloud.write() : cloud.read()).then(resolve),
    };
    return q;
  } }),
}));
import { erp, setCacheOrg } from "../api";

const result = (name: string) => ({ data: [{ id: 1, name }], error: null });
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("org", "alice");
  cloud.read.mockReset(); cloud.write.mockReset().mockResolvedValue({ data: { id: 1 }, error: null });
  cloud.read.mockResolvedValue(result("Current"));
});
afterEach(() => vi.restoreAllMocks());

it("shares simultaneous list reads and serves a fresh snapshot without another network call", async () => {
  const rows = await Promise.all(Array.from({ length: 8 }, () => erp.products()));
  expect(cloud.read).toHaveBeenCalledTimes(1);
  expect(rows.every(row => row[0].name === "Current")).toBe(true);
  await erp.products();
  expect(cloud.read).toHaveBeenCalledTimes(1);
});

it("an old in-flight response cannot overwrite a completed save, even in the same millisecond", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const oldRead = erp.products();
  await waitFor(() => expect(cloud.read).toHaveBeenCalledTimes(1));
  await erp.updateProduct(1, { name: "Saved" });
  cloud.read.mockResolvedValue(result("Saved"));
  const current = await erp.products();
  release(result("Old"));
  expect((await oldRead)[0].name).toBe("Saved");
  expect(current[0].name).toBe("Saved");
  expect((await erp.products())[0].name).toBe("Saved");
  expect(cloud.read).toHaveBeenCalledTimes(2);
});

it("rejects a late response across sign-out/sign-in and never stores it for the next session", async () => {
  let release!: (value: ReturnType<typeof result>) => void;
  cloud.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const oldRead = erp.products();
  const rejection = expect(oldRead).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.read).toHaveBeenCalledTimes(1));
  setCacheOrg(null); setCacheOrg("org", "alice");
  release(result("Previous session"));
  await rejection;
  expect((await erp.products())[0].name).toBe("Current");
});

it("invalidates fresh snapshots when another client changes data", async () => {
  await erp.products();
  cloud.read.mockResolvedValue(result("Remote update"));
  window.dispatchEvent(new Event("filey:cloud-change"));
  expect((await erp.products())[0].name).toBe("Remote update");
  expect(cloud.read).toHaveBeenCalledTimes(2);
});
