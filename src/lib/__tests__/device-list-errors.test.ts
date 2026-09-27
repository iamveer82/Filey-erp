import { expect, it, vi } from "vitest";
import { listOrgDevices, releaseOrgDevice } from "../license";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: { from: () => ({ select: () => ({ order: mocks.query }),
  delete: () => ({ eq: () => ({ select: () => ({ single: mocks.query }) }) }) }) } }));
it("does not report failed reads as empty lists or unacknowledged releases as success", async () => {
  mocks.query.mockResolvedValue({ data: null, error: { message: "Denied" } });
  await expect(listOrgDevices()).rejects.toThrow("Could not load your devices");
  await expect(releaseOrgDevice("device")).rejects.toThrow("Denied");
  mocks.query.mockResolvedValue({ data: null, error: null });
  await expect(releaseOrgDevice("device")).rejects.toThrow("could not be released");
  mocks.query.mockResolvedValue({ data: [], error: null });
  await expect(listOrgDevices()).resolves.toEqual([]);
  mocks.query.mockResolvedValue({ data: { id: "device" }, error: null });
  await expect(releaseOrgDevice("device")).resolves.toBeUndefined();
});
