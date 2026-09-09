import { beforeEach, expect, it, vi } from "vitest";
import { platformCall } from "../integrations";

const state = vi.hoisted(() => ({
  scope: "local:org:user",
  getSession: vi.fn(),
  invokeFn: vi.fn(),
}));
vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: state.getSession } },
  invokeFn: state.invokeFn,
}));
vi.mock("../agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  requireAgentStorageScope: (expected: string) => {
    if (state.scope !== expected) throw new Error("Workspace changed.");
    return state.scope;
  },
}));

beforeEach(() => {
  state.scope = "local:org:user";
  state.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { access_token: "checked-session-token" } } });
  state.invokeFn
    .mockReset()
    .mockResolvedValue({ data: { id: "post-1", status: "published" }, error: null });
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

it("preserves the existing unscoped connector call contract", async () => {
  await platformCall("composio", "status");
  expect(state.invokeFn.mock.calls[0][2]).toEqual({
    body: { provider: "composio", action: "status", payload: {} },
  });
  expect(state.invokeFn.mock.calls[0][3]).toBe(2);
});
