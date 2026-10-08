import { beforeEach, afterEach, expect, it, vi } from "vitest";
const cloud = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => cloud }));
import { billing, quotes, pos, receipts, setCacheOrg } from "../api";

const token = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("workspace-a", "alice");
  cloud.rpc.mockReset().mockResolvedValue({ data: token, error: null });
  cloud.from.mockReset();
});
afterEach(() => { setCacheOrg(null); vi.restoreAllMocks(); });

it.each([["invoice", billing], ["quotation", quotes], ["purchase_order", pos], ["receipt", receipts]] as const)(
  "%s enables and revokes a public link without changing team sharing", async (type, api) => {
    expect(await api.publicLink(17)).toBe(token);
    expect(cloud.rpc).toHaveBeenLastCalledWith("filey_set_public_document_link", {
      p_type: type, p_id: 17, p_enabled: true, p_expected_org: "workspace-a",
    });
    cloud.rpc.mockResolvedValue({ data: null, error: null });
    await api.revokePublicLink(17);
    expect(cloud.rpc).toHaveBeenLastCalledWith("filey_set_public_document_link", {
      p_type: type, p_id: 17, p_enabled: false, p_expected_org: "workspace-a",
    });
    expect(cloud.from).not.toHaveBeenCalled();
  });

it("does not publish in local mode, while signed out, or for an unsaved document", async () => {
  localStorage.setItem("filey_data_mode", "local");
  await expect(billing.publicLink(17)).rejects.toThrow("Cloud mode");
  localStorage.setItem("filey_data_mode", "cloud"); setCacheOrg(null);
  await expect(billing.publicLink(17)).rejects.toThrow("cloud workspace");
  setCacheOrg("workspace-a", "alice");
  await expect(billing.publicLink(-1)).rejects.toThrow("saved document");
  expect(cloud.rpc).not.toHaveBeenCalled();
});

it("rejects an unconfirmed enable without falling back to the old team toggle", async () => {
  cloud.rpc.mockResolvedValue({ data: null, error: null });
  await expect(billing.publicLink(17)).rejects.toThrow("could not be confirmed");
  cloud.rpc.mockResolvedValue({ data: null, error: new Error("No permission") });
  await expect(billing.publicLink(17)).rejects.toThrow("No permission");
  expect(cloud.from).not.toHaveBeenCalled();
});

it("rejects a late response after switching workspaces and returning", async () => {
  let finish!: (result: unknown) => void;
  cloud.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = billing.publicLink(17);
  await vi.waitFor(() => expect(cloud.rpc).toHaveBeenCalled());
  setCacheOrg("workspace-b", "alice"); setCacheOrg("workspace-a", "alice");
  finish({ data: token, error: null });
  await expect(pending).rejects.toThrow("workspace changed");
  expect(cloud.rpc).toHaveBeenCalledTimes(1);
});
