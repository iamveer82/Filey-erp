import { expect, it, vi } from "vitest";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { sessionFetch, verifyCloudSession } from "../cloudSession";

const url = "https://project.supabase.co";
const expired = "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired";
const failure = (status = 401, message = expired) => Response.json({ message }, { status });
const init = { method: "POST", headers: { Authorization: "Bearer old" }, body: JSON.stringify({ p_table: "invoice_docs", p_records: [{ id: 7 }] }) };

function fixture() {
  const original = { user: { id: "owner" }, access_token: "old", expires_at: Date.now() / 1000 + 3600 } as Session;
  let session: Session | null = original;
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    refreshSession: vi.fn(async () => {
      session = { ...original, access_token: "new" };
      return { data: { session: session as Session | null }, error: null };
    }),
    getUser: vi.fn(async (_jwt?: string) => ({ data: { user: session?.user ?? null }, error: null as unknown })),
  };
  return { original, auth, client: { auth } as unknown as SupabaseClient, setSession: (next: Session | null) => { session = next; } };
}

it.each(["rest/v1/rpc/sync_records", "storage/v1/object/files/owner/invoice.pdf"])("renews a server-rejected token and retries only the rejected %s upload", async path => {
  const f = fixture();
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(failure()).mockResolvedValueOnce(Response.json({ ok: true }));
  const response = await sessionFetch(url, () => f.client, send)(`${url}/${path}`, init);
  expect(await response.json()).toEqual({ ok: true });
  expect(f.auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  const retry = send.mock.calls[1][1]!;
  expect(new Headers(retry.headers).get("Authorization")).toBe("Bearer new");
  expect(retry.body).toBe(init.body);
  expect(retry.method).toBe("POST");
});

it("does not add refresh calls for healthy requests", async () => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  await sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init);
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.auth.refreshSession).not.toHaveBeenCalled();
});

it.each([401, 403, 500])("does not replay permissions, business or server errors (%s)", async status => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockResolvedValue(failure(status, "Access denied"));
  await sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init);
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.auth.refreshSession).not.toHaveBeenCalled();
});

it.each([`${url}/auth/v1/token`, `${url}/auth/v1/user`, "https://other.test/rest/v1/invoice_docs"])("does not recurse into Auth or cross origins: %s", async target => {
  const getClient = vi.fn(() => { throw new Error("Auth lock must not be acquired"); });
  const send = vi.fn<typeof fetch>().mockResolvedValue(failure());
  await sessionFetch(url, getClient, send)(target, init);
  expect(getClient).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});

it("stops after one renewal if the server still rejects the token", async () => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockImplementation(async () => failure());
  await expect(sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init)).rejects.toThrow("Reconnect your Filey account");
  expect(send).toHaveBeenCalledTimes(2);
  expect(f.auth.refreshSession).toHaveBeenCalledTimes(1);
});

it("never falls back to the expired session when refresh returns no session", async () => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockResolvedValue(failure());
  f.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init)).rejects.toThrow("device records are safe");
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([null, { user: { id: "someone-else" }, access_token: "other" } as Session])("does not replay an upload if its owner signs out or changes (%j)", async next => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockImplementation(async () => { f.setSession(next); return failure(); });
  await expect(sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init)).rejects.toThrow(/Reconnect/);
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.auth.refreshSession).not.toHaveBeenCalled();
});

it("shares a renewal across simultaneous rejected uploads", async () => {
  const f = fixture();
  const renew = f.auth.refreshSession.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.auth.refreshSession.mockImplementation(async () => { await gate; return renew(); });
  const send = vi.fn<typeof fetch>().mockImplementation(async (_input, options) => new Headers(options?.headers).get("Authorization") === "Bearer old" ? failure() : Response.json({ ok: true }));
  const request = sessionFetch(url, () => f.client, send);
  const pending = Promise.all([request(`${url}/rest/v1/invoice_docs`, init), request(`${url}/rest/v1/orders`, init)]);
  await vi.waitFor(() => expect(f.auth.refreshSession).toHaveBeenCalledTimes(1));
  release();
  await pending;
  expect(f.auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(4);
});

it("does not replay an ambiguous network failure", async () => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init)).rejects.toThrow("Failed to fetch");
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.auth.refreshSession).not.toHaveBeenCalled();
});

it("does not replay when the active account changes during renewal", async () => {
  const f = fixture(), send = vi.fn<typeof fetch>().mockResolvedValue(failure());
  f.auth.refreshSession.mockImplementation(async () => {
    const session = { ...f.original, user: { ...f.original.user, id: "someone-else" } };
    f.setSession(session);
    return { data: { session }, error: null };
  });
  await expect(sessionFetch(url, () => f.client, send)(`${url}/rest/v1/invoice_docs`, init)).rejects.toThrow("account changed");
  expect(send).toHaveBeenCalledTimes(1);
});

it("renews the exact expired-claims error from workspace verification", async () => {
  const f = fixture();
  f.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: expired, status: 403 } });
  await verifyCloudSession(f.client, f.original);
  expect(f.auth.getUser.mock.calls.map(call => call[0])).toEqual(["old", "new"]);
  expect(f.auth.refreshSession).toHaveBeenCalledTimes(1);
});

it("keeps workspace verification bounded and translates a persistent expired session", async () => {
  const f = fixture();
  f.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: expired, status: 403 } });
  await expect(verifyCloudSession(f.client, f.original)).rejects.toThrow("Reconnect your Filey account");
  expect(f.auth.getUser).toHaveBeenCalledTimes(2);
  expect(f.auth.refreshSession).toHaveBeenCalledTimes(1);
});

it.each([false, true])("recovers through the real Supabase client (verify workspace first: %s)", async verifyFirst => {
  const { original } = fixture();
  const user = { id: original.user.id, aud: "authenticated", role: "authenticated", email: "owner@example.test" };
  const stored = new Map([["session-test", JSON.stringify({ ...original, user, refresh_token: "refresh-old", token_type: "bearer" })]]);
  const send = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
    const path = String(input);
    if (path.includes("/auth/v1/token")) return Response.json({ access_token: "new", refresh_token: "refresh-new", expires_in: 3600, token_type: "bearer", user });
    if (new Headers(options?.headers).get("Authorization") === "Bearer old") return failure(path.includes("/auth/") ? 403 : 401);
    if (path.includes("/auth/v1/user")) return Response.json(user);
    expect(path).toContain("/rest/v1/rpc/sync_records");
    return Response.json([{ id: 7, ok: true, revision: 2 }]);
  });
  const client: SupabaseClient = createClient(url, "test-publishable-key", {
    auth: {
      autoRefreshToken: false, detectSessionInUrl: false, persistSession: true, storageKey: "session-test",
      storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    },
    global: { fetch: sessionFetch(url, () => client, send) },
  });
  if (verifyFirst) await verifyCloudSession(client, (await client.auth.getSession()).data.session!);
  const result = await client.rpc("sync_records", { p_table: "invoice_docs", p_records: [{ id: 7 }] });
  expect(result.error).toBeNull();
  expect(result.data).toEqual([{ id: 7, ok: true, revision: 2 }]);
  expect(send.mock.calls.filter(([target]) => String(target).includes("/auth/v1/token"))).toHaveLength(1);
  expect((await client.auth.getSession()).data.session?.user.id).toBe(user.id);
  expect((await client.auth.getSession()).data.session?.access_token).toBe("new");
});
