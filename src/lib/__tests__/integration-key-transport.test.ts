import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient, Session } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null, network: vi.fn() }));
vi.mock("../supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { sessionFetch } = await import("../cloudSession");
  state.client = createClient("https://key-fixture.supabase.co", "synthetic-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: sessionFetch("https://key-fixture.supabase.co", () => state.client, state.network) },
  });
  return { supabase: state.client, invokeFn: vi.fn() };
});
vi.mock("../api", () => ({ getCacheOrg: () => "fixture-org" }));
vi.mock("../agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  requireAgentStorageScope: () => "cloud:fixture-org:user:reviewed-owner",
}));

import { clearCloudKey, hasCloudKey, saveCloudKey } from "../integrations";

const session = (id: string, token: string) => ({ user: { id }, access_token: token }) as Session;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  // Wait for the real client's no-session initialization before spying on Auth.
  await state.client!.auth.getSession();
  state.network.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); });

it.each(["read", "save", "remove"])("the actual SDK cannot retarget a %s to the new account while preparing HTTP", async action => {
  vi.spyOn(state.client!.auth, "getSession")
    .mockResolvedValueOnce({ data: { session: session("reviewed-owner", "reviewed-owner-token") }, error: null })
    .mockResolvedValue({ data: { session: session("new-owner", "new-owner-token") }, error: null });
  state.network.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe("/rest/v1/integration_keys");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer reviewed-owner-token");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    if (action === "save") {
      expect(JSON.parse(init.body)).toMatchObject({ user_id: "reviewed-owner", api_key: "synthetic-private-project-key" });
    } else {
      expect(url.searchParams.get("user_id")).toBe("eq.reviewed-owner");
      if (action === "read") expect(url.searchParams.get("select")).toBe("provider");
    }
    return action === "read" ? Response.json({ provider: "composio" }) : new Response(null, { status: 204 });
  });
  const operation = action === "read" ? hasCloudKey("composio") : action === "save" ? saveCloudKey("composio", "synthetic-private-project-key") : clearCloudKey("composio");
  await expect(operation).rejects.toThrow("Your account changed");
  expect(state.network).toHaveBeenCalledOnce();
});
