import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: { id: "owner", email: "owner@example.test" } as {
    id: string;
    email: string;
  } | null,
  copyFails: false,
  migrating: false,
  syncOk: true,
  syncCalls: 0,
  copies: 0,
  busy: false,
  beforeProfile: () => {},
  beforeVerification: () => {},
}));
vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: state.user ? { user: state.user } : null },
        error: null,
      }),
      getUser: async () => {
        const user = state.user;
        state.beforeVerification();
        return { data: { user }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const profile = { ...state.user, name: "Owner", company: "Company" };
            state.beforeProfile();
            return { data: profile, error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock("../license", () => ({ canUseLocalMode: async () => true, hasLocalData: async () => !!localStorage.getItem("localdb:products") }));
vi.mock("../auth", () => ({
  getLocalProfile: () => ({ id: "owner", name: "Owner" }),
  adoptLocalProfile: (p: unknown) =>
    localStorage.setItem("filey_local_profile", JSON.stringify(p)),
}));
vi.mock("../sync", () => ({
  getSyncStatus: () => ({ state: "idle" }),
  isMigrating: () => state.migrating || state.busy,
  autoSyncEnabled: () => localStorage.getItem("filey_auto_sync") === "on",
  syncCycle: async () => {
    // Exercise the same lock ordering as the real engine: nested locks reject.
    if (state.migrating) throw new Error("Migration already running");
    state.syncCalls++;
    return state.syncOk;
  },
  resolveSyncConflicts: vi.fn(),
  setMigrating: (v: boolean) => {
    state.migrating = v;
  },
  setAutoSyncEnabled: (v: boolean) =>
    localStorage.setItem("filey_auto_sync", v ? "on" : "off"),
}));
vi.mock("../migrate", () => ({
  migrateCloudToLocal: async () => {
    state.copies++;
    expect(state.migrating).toBe(true);
    if (state.copyFails) throw new Error("Copy failed");
    return [];
  },
}));
import { switchWorkspace } from "../switchWorkspace";
import { getLocalCredential, isLocalSignedIn } from "../localAuth";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  state.user = { id: "owner", email: "owner@example.test" };
  state.copyFails = false;
  state.migrating = false;
  state.busy = false;
  state.syncOk = true;
  state.syncCalls = state.copies = 0;
  state.beforeProfile = () => {};
  state.beforeVerification = () => {};
});
it("round-trips storage without changing records or losing the account", async () => {
  localStorage.setItem("localdb:products", '[{"id":7,"name":"Local only"}]');
  await switchWorkspace("local");
  expect(isLocalSignedIn()).toBe(true);
  expect(getLocalCredential()?.userId).toBe("owner");
  expect(localStorage.getItem("filey_auto_sync")).toBe("off");
  await switchWorkspace("cloud");
  expect(localStorage.getItem("filey_data_mode")).toBe("cloud");
  expect(localStorage.getItem("localdb:products")).toContain("Local only");
  expect(state.user?.id).toBe("owner");
  expect(state.copies).toBe(1);
  expect(state.syncCalls).toBe(1);
});
it("keeps the current workspace open if cloud sign-in is missing", async () => {
  localStorage.setItem("filey_data_mode", "local");
  state.user = null;
  await expect(switchWorkspace("cloud")).rejects.toThrow("Connect your cloud account");
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
  expect(state.migrating).toBe(false);
});
it("does not switch or claim a session after a failed copy", async () => {
  state.copyFails = true;
  await expect(switchWorkspace("local")).rejects.toThrow("Couldn't finish saving your cloud data");
  expect(localStorage.getItem("filey_data_mode")).toBe("cloud");
  expect(isLocalSignedIn()).toBe(false);
});
it("refreshes an existing device workspace before switching off cloud", async () => {
  localStorage.setItem("localdb:products", '[{"id":7,"name":"Keep local"}]');
  await switchWorkspace("local");
  expect(state.copies).toBe(1);
  expect(localStorage.getItem("localdb:products")).toContain("Keep local");
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
});
it("rejects a cloud account that does not own the device workspace", async () => {
  localStorage.setItem("filey_local_workspace_owner", "another-owner");
  await expect(switchWorkspace("local")).rejects.toThrow("another account");
  expect(localStorage.getItem("filey_data_mode")).toBe("cloud");
});

it.each(["on", "off"])("turning cloud off pauses background sync (previously %s)", async preference => {
  localStorage.setItem("filey_auto_sync", preference);
  await switchWorkspace("local");
  await switchWorkspace("cloud");
  await switchWorkspace("local");
  expect(localStorage.getItem("filey_auto_sync")).toBe("off");
});

it("keeps local mode and restores background sync after a failed upload", async () => {
  localStorage.setItem("filey_data_mode", "local");
  localStorage.setItem("filey_auto_sync", "on");
  state.syncOk = false;
  await expect(switchWorkspace("cloud")).rejects.toThrow("Couldn't finish saving to Filey Cloud");
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
  expect(localStorage.getItem("filey_auto_sync")).toBe("on");
  expect(state.migrating).toBe(false);
});

it("waits for an active sync instead of overlapping it", async () => {
  state.busy = true;
  await expect(switchWorkspace("local")).rejects.toThrow("current data transfer");
  expect(state.copies).toBe(0);
});

it("releases the switch lock even when saving preferences fails", async () => {
  const write = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "filey_auto_sync") throw new Error("Storage unavailable");
    return write.call(this, key, value);
  });
  try { await expect(switchWorkspace("local")).rejects.toThrow("Storage unavailable"); }
  finally { spy.mockRestore(); }
  expect(localStorage.getItem("filey_data_mode")).toBe("cloud");
  await switchWorkspace("local");
  expect(localStorage.getItem("filey_data_mode")).toBe("local");
});

it.each(["local", "cloud"] as const)("cancels switching to %s if sign-out occurs during verification", async target => {
  const source = target === "local" ? "cloud" : "local";
  localStorage.setItem("filey_data_mode", source);
  state.beforeProfile = state.beforeVerification = () => { state.user = null; };
  await expect(switchWorkspace(target)).rejects.toThrow("account changed");
  expect(localStorage.getItem("filey_data_mode")).toBe(source);
  expect(isLocalSignedIn()).toBe(false);
  expect(getLocalCredential()).toBeNull();
  expect(state.migrating).toBe(false);
});
