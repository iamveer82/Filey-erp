import { beforeEach, expect, it, vi } from "vitest";
import { platformCall, clearCloudKey, hasCloudKey, saveCloudKey } from "../integrations";

const state = vi.hoisted(() => ({
  scope: "local:org:user",
  org: "org-a",
  getSession: vi.fn(),
  invokeFn: vi.fn(),
  from: vi.fn(),
}));
vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: state.getSession }, from: state.from },
  invokeFn: state.invokeFn,
}));
vi.mock("../agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  requireAgentStorageScope: (expected?: string) => {
    if (expected && state.scope !== expected) throw new Error("Workspace changed.");
    return state.scope;
  },
}));
vi.mock("../api", () => ({ getCacheOrg: () => state.org }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  state.scope = "local:org:user";
  state.org = "org-a";
  state.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { user: { id: "user-a" }, access_token: "checked-session-token" } } });
  state.from.mockReset();
  state.invokeFn
    .mockReset()
    .mockResolvedValue({ data: { id: "post-1", status: "published" }, error: null });
});

it("never reads or stores cloud integration credentials in local mode", async () => {
  localStorage.setItem("filey_data_mode", "local");
  expect(await hasCloudKey("composio")).toBe(false);
  await expect(saveCloudKey("composio", "private-device-key")).rejects.toThrow("personal key in the installed app");
  await expect(clearCloudKey("composio")).rejects.toThrow("switch to cloud mode");
  expect(state.getSession).not.toHaveBeenCalled();
  expect(state.from).not.toHaveBeenCalled();
});

it("does not save a cloud key if local mode is selected while credentials resolve", async () => {
  state.getSession.mockImplementationOnce(async () => {
    localStorage.setItem("filey_data_mode", "local");
    return { data: { session: { user: { id: "user-a" }, access_token: "checked-session-token" } } };
  });
  await expect(saveCloudKey("composio", "private-device-key")).rejects.toThrow("Local mode keeps your settings");
  expect(state.from).not.toHaveBeenCalled();
});

it("binds social publishing to the checked session and disables function retries", async () => {
  await platformCall(
    "zernio",
    "create_post",
    { input: { content: "Reviewed post" } },
    state.scope
  );
  expect(state.invokeFn).toHaveBeenCalledTimes(1);
  expect(state.invokeFn.mock.calls[0][2]).toMatchObject({
    body: {
      provider: "zernio",
      action: "create_post",
      payload: { input: { content: "Reviewed post" } },
      expected_org_id: "org-a",
    },
    headers: { Authorization: "Bearer checked-session-token" },
  });
  expect(state.invokeFn.mock.calls[0][3]).toBe(0);
  await platformCall("zernio", "delete_post", { post_id: "post-1" }, state.scope);
  expect(state.invokeFn.mock.calls[1][3]).toBe(0);
  await platformCall("zernio", "accounts", {}, state.scope);
  expect(state.invokeFn.mock.calls[2][3]).toBe(2);
});

it("aborts a scoped proxy operation during the SDK's asynchronous fetch preparation", async () => {
  state.invokeFn.mockImplementationOnce(async (_client, _name, options) => {
    expect(options.signal.aborted).toBe(false);
    state.scope = "cloud:another-org:user";
    window.dispatchEvent(new Event("filey:agent-storage"));
    expect(options.signal.aborted).toBe(true);
    return { data: null, error: new Error("Aborted") };
  });
  await expect(platformCall("zernio", "create_post", {}, "local:org:user")).rejects.toThrow("Workspace changed");
});

it("refuses the send when session lookup completes in another workspace", async () => {
  state.getSession.mockImplementationOnce(async () => {
    state.scope = "cloud:another-org:user";
    return { data: { session: { access_token: "other-token" } } };
  });
  await expect(
    platformCall("zernio", "create_post", {}, "local:org:user")
  ).rejects.toThrow("Workspace changed");
  expect(state.invokeFn).not.toHaveBeenCalled();
});

it("captures the reviewed organization before waiting for the session", async () => {
  state.getSession.mockImplementationOnce(async () => {
    // A server/cross-tab switch can reach the auth SDK before our local scope
    // listener. The edge must receive the original intent and reject retargeting.
    state.org = "org-b";
    return { data: { session: { user: { id: "user-a" }, access_token: "checked-session-token" } } };
  });
  await platformCall("composio", "execute", { tool_slug: "SEND_EMAIL" });
  expect(state.invokeFn.mock.calls[0][2].body.expected_org_id).toBe("org-a");
});

it("refuses a connector call when the session changes before cache identity catches up", async () => {
  state.scope = "cloud:org-a:user:user-a";
  state.getSession.mockResolvedValueOnce({
    data: { session: { user: { id: "user-b" }, access_token: "other-account-token" } },
  });
  await expect(platformCall("composio", "execute", { tool_slug: "SEND_EMAIL" }))
    .rejects.toThrow("Your account changed");
  expect(state.invokeFn).not.toHaveBeenCalled();
});

it("refuses key reads, saves and deletion when session owner disagrees with the reviewed identity", async () => {
  state.scope = "cloud:org-a:user:user-a";
  state.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-b" }, access_token: "other-account-token" } },
  });
  await expect(hasCloudKey("composio")).rejects.toThrow("Your account changed");
  await expect(saveCloudKey("composio", "reviewed-account-key")).rejects.toThrow("Your account changed");
  await expect(clearCloudKey("composio")).rejects.toThrow("Your account changed");
  expect(state.from).not.toHaveBeenCalled();
});

it("withholds late provider data and errors from the next workspace", async () => {
  state.invokeFn.mockImplementationOnce(async () => {
    state.scope = "cloud:another-org:user";
    return { data: { private: "old workspace" }, error: null };
  });
  await expect(platformCall("zernio", "accounts", {}, "local:org:user")).rejects.toThrow(
    "Workspace changed"
  );
  state.scope = "local:org:user";
  state.invokeFn.mockResolvedValueOnce({
    data: null,
    error: {
      context: {
        json: async () => {
          state.scope = "cloud:another-org:user";
          return { error: "private old workspace error" };
        },
      },
    },
  });
  await expect(
    platformCall("zernio", "create_post", {}, "local:org:user")
  ).rejects.toThrow("Workspace changed");
});

it("pins and scopes connector calls even when the caller omits an explicit scope", async () => {
  await platformCall("composio", "status");
  expect(state.invokeFn.mock.calls[0][2]).toMatchObject({
    body: { provider: "composio", action: "status", payload: {} },
    headers: { Authorization: "Bearer checked-session-token" },
  });
  expect(state.invokeFn.mock.calls[0][3]).toBe(2);
});

it("aborts a default connector execution when account or workspace changes", async () => {
  state.invokeFn.mockImplementationOnce(async (_client, _name, options) => {
    expect(options.headers.Authorization).toBe("Bearer checked-session-token");
    state.scope = "cloud:another-org:another-user";
    window.dispatchEvent(new Event("filey:agent-storage"));
    expect(options.signal.aborted).toBe(true);
    return { data: null, error: new Error("Aborted") };
  });
  await expect(platformCall("composio", "execute", { action: "SEND_EMAIL" })).rejects.toThrow("Workspace changed");
  expect(state.invokeFn).toHaveBeenCalledTimes(1);
});

it("does not delete the newly signed-in account's integration key during delayed dispatch", async () => {
  const rows = new Map([["user-a", "key-a"], ["user-b", "key-b"]]);
  const filters = new Map<string, string>();
  const query = {
    delete: () => query,
    eq: (key: string, value: string) => { filters.set(key, value); return query; },
    setHeader: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => {
      // Emulate the SDK taking user B's token immediately before PostgREST.
      state.scope = "cloud:another-org:user-b";
      const activeUser = "user-b";
      if (!filters.has("user_id") || filters.get("user_id") === activeUser) rows.delete(activeUser);
      resolve({ error: null });
    },
  };
  state.from.mockReturnValue(query);
  await expect(clearCloudKey("composio")).rejects.toThrow("Workspace changed");
  expect(filters.get("user_id")).toBe("user-a");
  expect(query.setHeader).toHaveBeenCalledWith("Authorization", "Bearer checked-session-token");
  expect(rows.get("user-b")).toBe("key-b");
  expect(rows.get("user-a")).toBe("key-a");
});

it("refuses key mutations when session lookup returns after a workspace switch", async () => {
  state.getSession.mockImplementationOnce(async () => {
    state.scope = "cloud:another-org:user-b";
    return { data: { session: { user: { id: "user-b" }, access_token: "b-token" } } };
  });
  await expect(saveCloudKey("composio", "private-key-a")).rejects.toThrow("Workspace changed");
  expect(state.from).not.toHaveBeenCalled();
});

it("checks the captured owner's non-secret key metadata and withholds late results", async () => {
  const filters = new Map<string, string>();
  const query = {
    select: vi.fn(() => query),
    eq: (key: string, value: string) => { filters.set(key, value); return query; },
    setHeader: vi.fn(() => query),
    maybeSingle: async () => { state.scope = "cloud:another-org:user-b"; return { data: { provider: "composio" }, error: null }; },
  };
  state.from.mockReturnValue(query);
  await expect(hasCloudKey("composio")).rejects.toThrow("Workspace changed");
  expect(filters.get("user_id")).toBe("user-a");
  expect(query.select).toHaveBeenCalledWith("provider");
  expect(query.setHeader).toHaveBeenCalledWith("Authorization", "Bearer checked-session-token");
});

it.each(["", " ", "key with spaces", "key\ninside", "é-private-key", "k".repeat(4097)])("rejects malformed keys before any identity or database request", async key => {
  await expect(saveCloudKey("composio", key)).rejects.toThrow("Enter a valid API key");
  expect(state.getSession).not.toHaveBeenCalled();
  expect(state.from).not.toHaveBeenCalled();
});

it("saves only a trimmed key with the original account bearer and no secret readback", async () => {
  const query = {
    upsert: vi.fn(() => query), setHeader: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  state.from.mockReturnValue(query);
  await saveCloudKey("composio", "  synthetic-project-key  ");
  expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-a", provider: "composio", api_key: "synthetic-project-key" }), { onConflict: "user_id,provider" });
  expect(query.setHeader).toHaveBeenCalledWith("Authorization", "Bearer checked-session-token");
  expect(state.getSession).toHaveBeenCalledTimes(2);
});

it.each(["read", "save", "remove"])("does not report %s success when the auth identity changed before cache adoption", async action => {
  const query = {
    select: () => query, upsert: () => query, delete: () => query, eq: () => query, setHeader: vi.fn(() => query),
    maybeSingle: async () => ({ data: { provider: "composio" }, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  state.from.mockReturnValue(query);
  state.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "user-a" }, access_token: "original-token" } } })
    .mockResolvedValueOnce({ data: { session: { user: { id: "user-b" }, access_token: "new-token" } } });
  const operation = action === "read" ? hasCloudKey("composio") : action === "save" ? saveCloudKey("composio", "synthetic-project-key") : clearCloudKey("composio");
  await expect(operation).rejects.toThrow("Your account changed");
  expect(query.setHeader).toHaveBeenCalledWith("Authorization", "Bearer original-token");
});

it.each(["read", "save", "remove"])("redacts secret-bearing database failures from %s", async action => {
  const result = { data: null, error: { message: "synthetic-private-key-and-customer-name" } };
  const query = {
    select: () => query, upsert: () => query, delete: () => query, eq: () => query, setHeader: () => query,
    maybeSingle: async () => result, then: (resolve: (value: unknown) => void) => resolve(result),
  };
  state.from.mockReturnValue(query);
  const operation = action === "read" ? hasCloudKey("composio") : action === "save" ? saveCloudKey("composio", "synthetic-project-key") : clearCloudKey("composio");
  await expect(operation).rejects.toThrow(/Could not (verify|save|remove)/);
  await expect(operation).rejects.not.toThrow("synthetic-private-key");
});

it("never retries connector executions, connection creation or unknown actions", async () => {
  for (const action of ["execute", "connect", "future_action"]) {
    await platformCall("composio", action);
    expect(state.invokeFn.mock.lastCall?.[3]).toBe(0);
  }
});
