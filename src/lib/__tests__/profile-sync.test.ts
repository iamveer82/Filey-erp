import { beforeEach, expect, it, vi } from "vitest";
import { pendingProfile, queueProfile, syncProfile } from "../profileSync";
import { adoptLocalProfile, getLocalProfile } from "../auth";
import { syncNow } from "../sync";

beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });
function cloud() {
  const write = vi.fn().mockResolvedValue({ data: { id: "owner" }, error: null });
  const update = vi.fn(() => ({ eq: (_key: string, uid: string) => {
    expect(uid).toBe("owner"); return { select: () => ({ single: write }) };
  } }));
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" }, expires_at: Date.now() / 1000 + 3600 } } }) },
    from: (table: string) => { expect(table).toBe("profiles"); return { update }; },
  };
  return { client, write, update };
}

it("syncs the photo even when no business records changed; retries errors and never uploads role or org", async () => {
  queueProfile("owner", { avatar: "data:image/png;base64,photo", role: "admin", org_id: "other" });
  const { client, write, update } = cloud();
  write.mockResolvedValueOnce({ data: null, error: { message: "Offline" } } as never);
  expect(await syncNow(client, { manual: true })).toBe(false);
  expect(pendingProfile("owner")).toEqual({ avatar: "data:image/png;base64,photo" });
  expect(await syncNow(client, { manual: true })).toBe(true);
  expect(update).toHaveBeenLastCalledWith({ avatar: "data:image/png;base64,photo" });
  expect(pendingProfile("owner")).toEqual({});
});

it("preserves edits while reconnecting or uploading and separates accounts", async () => {
  queueProfile("owner", { avatar: "local photo", name: "Local name" });
  adoptLocalProfile({ id: "owner", avatar: "old cloud photo", name: "Old name" });
  expect(getLocalProfile()).toMatchObject({ avatar: "local photo", name: "Local name" });
  const { client, write } = cloud();
  write.mockImplementationOnce(async () => { queueProfile("owner", { avatar: "new photo" }); return { data: { id: "owner" }, error: null }; });
  await syncProfile(client, "owner");
  expect(pendingProfile("owner").avatar).toBe("new photo");
  expect(pendingProfile("someone-else")).toEqual({});
  client.auth.getSession = async () => ({ data: { session: { user: { id: "someone-else" } } } });
  await expect(syncProfile(client, "owner")).rejects.toThrow("session changed");
  expect(pendingProfile("owner").avatar).toBe("new photo");
});
