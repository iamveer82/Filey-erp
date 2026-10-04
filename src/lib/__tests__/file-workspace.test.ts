import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  scope: "org-a:user:owner-a", local: false, uid: "owner-a", token: "original-token",
  blocked: false, getSession: vi.fn(), localStorage: { from: vi.fn() },
}));
vi.mock("../api", () => ({ getCacheScope: () => fixture.scope }));
vi.mock("../dataMode", () => ({
  isLocalMode: () => fixture.local,
  assertWorkspaceCurrent: () => { if (fixture.blocked) throw new Error("Workspace changed in another tab."); },
}));
vi.mock("../supabaseConfig", () => ({ supabaseUrl: "https://storage.fixture.invalid", supabaseAnonKey: "publishable-fixture" }));
vi.mock("../supabase", () => ({ sb: () => ({ auth: { getSession: fixture.getSession }, storage: fixture.localStorage }) }));
import { fileOperation } from "../fileWorkspace";

beforeEach(() => {
  fixture.scope = "org-a:user:owner-a"; fixture.local = false; fixture.uid = "owner-a";
  fixture.token = "original-token"; fixture.blocked = false;
  fixture.getSession.mockReset().mockImplementation(async () => ({ data: { session: {
    user: { id: fixture.uid }, access_token: fixture.token,
  } }, error: null }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("private original-account bytes", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

it("refuses an SDK account that differs from the reviewed screen before any network dispatch", async () => {
  fixture.uid = "owner-b";
  await expect(fileOperation()).rejects.toThrow("workspace changed");
  expect(fetch).not.toHaveBeenCalled();
});

it("uses an immutable original bearer for the real StorageClient even after a same-account token refresh", async () => {
  const operation = await fileOperation();
  fixture.token = "refreshed-token";
  const { data, error } = await operation.storage.from("user-files").download("owner-a/private.txt");
  expect(error).toBeNull(); expect(data?.size).toBe("private original-account bytes".length);
  const request = vi.mocked(fetch).mock.calls[0];
  expect(new Headers(request[1]?.headers).get("Authorization")).toBe("Bearer original-token");
  expect(request[1]?.redirect).toBe("error");
  expect(request[1]).toMatchObject({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  expect(fixture.localStorage.from).not.toHaveBeenCalled();
});

it.each(["account", "workspace", "mode", "cross-tab"])("refuses a %s change immediately before real StorageClient dispatch", async change => {
  const operation = await fileOperation();
  if (change === "account") fixture.uid = "owner-b";
  else if (change === "workspace") fixture.scope = "org-b:user:owner-a";
  else if (change === "mode") fixture.local = true;
  else fixture.blocked = true;
  const { data, error } = await operation.storage.from("user-files").download("owner-a/private.txt");
  expect(data).toBeNull(); expect(error?.message).toMatch(/workspace changed/i);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["account", "workspace", "mode", "cross-tab"])("discards the private storage response after a %s change during fetch", async change => {
  const operation = await fileOperation();
  vi.mocked(fetch).mockImplementationOnce(async () => {
    if (change === "account") fixture.uid = "owner-b";
    else if (change === "workspace") fixture.scope = "org-b:user:owner-a";
    else if (change === "mode") fixture.local = true;
    else fixture.blocked = true;
    return new Response("private original-account bytes", { status: 200 });
  });
  const { data, error } = await operation.storage.from("user-files").download("owner-a/private.txt");
  expect(data).toBeNull(); expect(error?.message).toMatch(/workspace changed/i);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not expose a signed URL after a new account appears during the response", async () => {
  const operation = await fileOperation();
  vi.mocked(fetch).mockImplementationOnce(async () => {
    fixture.uid = "owner-b";
    return Response.json({ signedURL: "/object/sign/user-files/owner-a/private.txt?token=private-link" });
  });
  const { data, error } = await operation.storage.from("user-files").createSignedUrl("owner-a/private.txt", 60);
  expect(data).toBeNull(); expect(error?.message).toMatch(/workspace changed/i);
});

it("reuses the local device storage API without constructing or contacting cloud storage", async () => {
  fixture.local = true; fixture.uid = "local-user";
  const operation = await fileOperation();
  expect(operation.storage).toBe(fixture.localStorage);
  expect(fetch).not.toHaveBeenCalled();
});
