import { beforeEach, afterEach, expect, it, vi } from "vitest";
const cloud = vi.hoisted(() => ({ user: "owner", afterSession: () => {}, rpc: vi.fn(), upload: vi.fn(), profile: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: {
  auth: {
    getSession: async () => {
      const user = cloud.user;
      cloud.afterSession();
      return { data: { session: { user: { id: user }, expires_at: Date.now() / 1000 + 3600 } }, error: null };
    },
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: cloud.user } }, error: null })),
    signUp: vi.fn(async () => ({ data: { session: { user: { id: cloud.user } } }, error: null })),
  },
  rpc: cloud.rpc,
  from: () => ({ update: cloud.profile }),
  storage: { from: () => ({ upload: cloud.upload }) },
} }));
import { supabase } from "../supabase";
import { withCloudTransfer, checkCloudTransfer, type CloudTransferPermit } from "../cloudTransfer";
import { autoSyncEnabled, cloudSignIn, cloudSignUp, startAutoSync, scheduleSync, setAutoSyncEnabled, syncNow, syncCycle, pushCollection, pushFileBlobs, resolveSyncConflicts } from "../sync";
import { migrateLocalToCloud } from "../migrate";
import { pendingProfile, queueProfile, syncProfile } from "../profileSync";
import { localClient, journalSnapshot } from "../localdb";
import { rememberLocalIdentity, setLocalSignedIn } from "../localAuth";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity("owner@example.test", "owner");
  setLocalSignedIn(true);
  localStorage.setItem("filey_local_profile", JSON.stringify({ id: "owner", org_id: "company" }));
  cloud.user = "owner"; cloud.afterSession = () => {};
  cloud.rpc.mockReset().mockResolvedValue({ data: { ok: true, revision: 2 }, error: null });
  cloud.upload.mockReset(); cloud.profile.mockReset();
});
afterEach(() => vi.useRealTimers());

it("never schedules uploads from legacy flags, saves, reconnect, focus or startup", async () => {
  vi.useFakeTimers();
  localStorage.setItem("filey_auto_sync", "on");
  localStorage.setItem("filey_cloud_seeded", "1");
  const stop = startAutoSync();
  setAutoSyncEnabled(true);
  await localClient.from("products").insert({ id: 7, name: "Private inventory" });
  for (const event of ["filey:local-write", "online", "focus"]) window.dispatchEvent(new Event(event));
  document.dispatchEvent(new Event("visibilitychange"));
  scheduleSync(1);
  await vi.advanceTimersByTimeAsync(600_000);
  stop();
  expect(autoSyncEnabled()).toBe(false);
  expect(localStorage.getItem("filey_auto_sync")).toBe("off");
  expect(cloud.rpc).not.toHaveBeenCalled();
  expect(cloud.upload).not.toHaveBeenCalled();
  expect((await journalSnapshot()).tables.products.changed).toEqual([7]);
});

it("identity sign-in and signup never seed or upload a local workspace", async () => {
  localStorage.setItem("filey_auto_sync", "on");
  await localClient.from("products").insert({ id: 9, name: "Private product" });
  await cloudSignIn("owner@example.test", "example-password");
  expect(await cloudSignUp("owner@example.test", "example-password")).toBe("session");
  expect(localStorage.getItem("filey_cloud_seeded")).toBeNull();
  expect(cloud.rpc).not.toHaveBeenCalled();
  expect((await journalSnapshot()).tables.products.changed).toEqual([9]);
});

it("manual flags cannot upload rows, files, profiles or migrations while remaining local", async () => {
  queueProfile("owner", { name: "Private name", avatar: "local picture" });
  await localClient.from("products").insert({ id: 7, name: "Private" });
  const before = await journalSnapshot();
  expect(await syncNow(supabase, { manual: true })).toBe(false);
  expect(await syncCycle(supabase, { manual: true })).toBe(false);
  await expect(pushCollection(supabase!, "products", [{ id: 7 }])).rejects.toThrow("confirm the transfer");
  await expect(pushFileBlobs(supabase!, "owner", [{ id: "file", storage_path: "private.pdf" }])).rejects.toThrow("confirm the transfer");
  await expect(syncProfile(supabase!, "owner")).rejects.toThrow("confirm the transfer");
  await expect(migrateLocalToCloud()).rejects.toThrow("confirm the transfer");
  await expect(resolveSyncConflicts(true, supabase)).rejects.toThrow("confirm the transfer");
  expect(cloud.rpc).not.toHaveBeenCalled();
  expect(cloud.upload).not.toHaveBeenCalled();
  expect(cloud.profile).not.toHaveBeenCalled();
  expect(pendingProfile("owner")).toEqual({ name: "Private name", avatar: "local picture" });
  expect(await journalSnapshot()).toEqual(before);
});

it("permits one explicit transfer and rejects permit reuse, forgery or a different client", async () => {
  let ended!: CloudTransferPermit;
  await withCloudTransfer(supabase!, "owner", async transfer => {
    ended = transfer;
    expect(await pushCollection(supabase!, "products", [{ id: 7, name: "Approved upload" }], undefined, "owner", transfer)).toEqual([]);
    await expect(checkCloudTransfer(transfer, { ...supabase! } as any)).rejects.toThrow("confirm the transfer");
  });
  expect(cloud.rpc).toHaveBeenCalledTimes(1);
  await expect(pushCollection(supabase!, "products", [{ id: 8 }], undefined, "owner", ended)).rejects.toThrow("confirm the transfer");
  await expect(checkCloudTransfer({} as CloudTransferPermit, supabase!)).rejects.toThrow("confirm the transfer");
  expect(cloud.rpc).toHaveBeenCalledTimes(1);
});

it.each(["signout", "organization", "mode", "account"])("denies dispatch if %s changes while credentials resolve", async change => {
  await withCloudTransfer(supabase!, "owner", async transfer => {
    cloud.afterSession = () => {
      if (change === "signout") setLocalSignedIn(false);
      if (change === "organization") localStorage.setItem("filey_local_profile", '{"id":"owner","org_id":"other"}');
      if (change === "mode") localStorage.setItem("filey_data_mode", "cloud");
      if (change === "account") cloud.user = "other";
    };
    if (change === "account") {
      // A Supabase credential lookup may have observed the preceding session.
      // The next lookup must fence the switched identity before dispatch.
      await checkCloudTransfer(transfer, supabase!);
    }
    await expect(pushCollection(supabase!, "products", [{ id: 7 }], undefined, "owner", transfer)).rejects.toThrow(/workspace|account|Sign in/);
    expect(cloud.rpc).not.toHaveBeenCalled();
  });
});

it("does not acknowledge local profile changes when transfer permission changes during upload", async () => {
  queueProfile("owner", { company: "Private company" });
  cloud.profile.mockImplementation(() => ({ eq: () => ({ select: () => ({ single: async () => {
    setLocalSignedIn(false);
    return { data: { id: "owner" }, error: null };
  } }) }) }));
  await withCloudTransfer(supabase!, "owner", async transfer => {
    await expect(syncProfile(supabase!, "owner", transfer)).rejects.toThrow("Sign in");
  });
  expect(pendingProfile("owner")).toEqual({ company: "Private company" });
});
