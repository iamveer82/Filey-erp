import { beforeEach, expect, it, vi } from "vitest";
import { listOrgDevices, releaseOrgDevice, checkCloudDeviceLogout, registerCloudDevice, deviceId } from "../license";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), legacy: vi.fn(), signOut: vi.fn(), session: vi.fn(), headers: vi.fn(),
  scope: "cloud:org-a:user:user-a", filter: vi.fn(),
}));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => mocks.scope }));
vi.mock("../supabase", () => {
  const request = (result: () => unknown) => ({ setHeader: (name: string, value: string) => {
    mocks.headers(name, value);
    return Promise.resolve().then(result);
  } });
  return { supabase: {
    from: () => ({ select: () => ({
      is: () => ({ order: () => request(() => mocks.query()) }),
      eq: (key: string, value: string) => {
        mocks.filter(key, value);
        return { eq: (key2: string, value2: string) => {
          mocks.filter(key2, value2);
          return { limit: () => ({ maybeSingle: () => request(() => mocks.legacy()) }) };
        } };
      },
    }) }),
    rpc: (name: string, args: unknown) => request(() => mocks.query(name, args)),
    auth: { signOut: mocks.signOut, getSession: mocks.session },
  } };
});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("filey:device_id", "install-a");
  mocks.scope = "cloud:org-a:user:user-a";
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "user-a" }, access_token: "session-a" } }, error: null });
  mocks.legacy.mockResolvedValue({ data: null, error: null });
});

it("reports device read/release errors and valid empty lists", async () => {
  mocks.query.mockResolvedValue({ data: null, error: { message: "Denied" } });
  await expect(listOrgDevices()).rejects.toThrow("Could not load your devices");
  await expect(releaseOrgDevice("device")).rejects.toThrow("Denied");
  mocks.query.mockResolvedValue({ data: null, error: null });
  await expect(releaseOrgDevice("device")).resolves.toBeUndefined();
  mocks.query.mockResolvedValue({ data: [], error: null });
  await expect(listOrgDevices()).resolves.toEqual([]);
  expect(mocks.query).toHaveBeenCalledWith("filey_logout_device", { p_id: "device" });
  expect(mocks.headers).toHaveBeenCalledWith("Authorization", "Bearer session-a");
});

it("registers shared-browser accounts with distinct cloud IDs while preserving Freedom's install ID", async () => {
  mocks.query.mockResolvedValue({ data: { ok: true }, error: null });
  await expect(registerCloudDevice()).resolves.toEqual({ ok: true });
  expect(mocks.query).toHaveBeenLastCalledWith("register_device", expect.objectContaining({ p_fingerprint: "install-a:user-a" }));
  mocks.scope = "cloud:org-a:user:user-b";
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "session-b" } } });
  await registerCloudDevice();
  expect(mocks.query).toHaveBeenLastCalledWith("register_device", expect.objectContaining({ p_fingerprint: "install-a:user-b" }));
  await expect(deviceId()).resolves.toBe("install-a");
  expect(mocks.filter).toHaveBeenCalledWith("user_id", "user-b");
});

it("uses the owned legacy fingerprint, including revoked rows, for registration and logout", async () => {
  mocks.legacy.mockResolvedValue({ data: { fingerprint: "install-a" }, error: null });
  mocks.query.mockResolvedValueOnce({ data: { ok: false, reason: "logged_out" }, error: null });
  await expect(registerCloudDevice()).resolves.toEqual({ ok: false, reason: "logged_out" });
  expect(mocks.query).toHaveBeenLastCalledWith("register_device", expect.objectContaining({ p_fingerprint: "install-a" }));
  mocks.query.mockResolvedValue({ data: true, error: null });
  await checkCloudDeviceLogout();
  expect(mocks.query).toHaveBeenLastCalledWith("filey_device_logged_out", { p_fingerprint: "install-a" });
  expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
});

it("checks the account-scoped cloud fingerprint when no legacy row exists", async () => {
  mocks.query.mockResolvedValue({ data: false, error: null });
  await checkCloudDeviceLogout();
  expect(mocks.query).toHaveBeenLastCalledWith("filey_device_logged_out", { p_fingerprint: "install-a:user-a" });
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("fails closed on a legacy row lookup failure instead of consuming another slot", async () => {
  mocks.legacy.mockResolvedValue({ data: null, error: { message: "Private SQL error" } });
  await expect(registerCloudDevice()).rejects.toThrow("Could not check this device");
  expect(mocks.query).not.toHaveBeenCalled();
});

it("refuses an SDK account switch before registration dispatch", async () => {
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "session-b" } } });
  await expect(registerCloudDevice()).rejects.toThrow("account or workspace changed");
  expect(mocks.legacy).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
});

it("does not dispatch registration after a workspace change during legacy lookup", async () => {
  mocks.legacy.mockImplementation(async () => {
    mocks.scope = "cloud:org-b:user:user-a";
    return { data: null, error: null };
  });
  await expect(registerCloudDevice()).rejects.toThrow("account or workspace changed");
  expect(mocks.query).not.toHaveBeenCalled();
});

it("discards private list results that arrive after an account change", async () => {
  mocks.query.mockImplementation(async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "session-b" } } });
    return { data: [{ fingerprint: "private-a" }], error: null };
  });
  await expect(listOrgDevices()).rejects.toThrow("account session changed");
  expect(mocks.headers).toHaveBeenCalledWith("Authorization", "Bearer session-a");
});

it("does not sign out a newer login when an earlier logout check finishes late", async () => {
  mocks.query.mockImplementation(async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id: "user-a" }, access_token: "new-session-a" } } });
    return { data: true, error: null };
  });
  await expect(checkCloudDeviceLogout()).rejects.toThrow("account session changed");
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("does not query or register without an authenticated session", async () => {
  mocks.session.mockResolvedValue({ data: { session: null }, error: null });
  await expect(registerCloudDevice()).resolves.toEqual({ ok: false, reason: "unauthenticated" });
  await expect(listOrgDevices()).resolves.toEqual([]);
  await checkCloudDeviceLogout();
  expect(mocks.query).not.toHaveBeenCalled();
});
