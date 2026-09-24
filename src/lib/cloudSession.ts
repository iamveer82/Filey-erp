import type { Session, SupabaseClient } from "@supabase/supabase-js";

export const CLOUD_RECONNECT_MESSAGE = "Your cloud connection expired. Reconnect your Filey account and try again. Your device records are safe.";
const ACCOUNT_CHANGED = "Your cloud account changed. Reconnect the workspace account before trying again.";
const refreshing = new WeakMap<SupabaseClient, Promise<Session>>();

export function isExpiredJwt(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message;
  return typeof message === "string" && /(?:jwt|token).*expired/i.test(message);
}

/** Renew only the originating account; reuse a concurrent renewal. */
export async function renewCloudSession(client: SupabaseClient, expected: Session): Promise<Session> {
  const current = await client.auth.getSession();
  if (current.error || !current.data.session) throw new Error(CLOUD_RECONNECT_MESSAGE);
  if (current.data.session.user.id !== expected.user.id) throw new Error(ACCOUNT_CHANGED);
  if (current.data.session.access_token !== expected.access_token) return current.data.session;
  let pending = refreshing.get(client);
  if (!pending) {
    pending = (async () => {
      const result = await client.auth.refreshSession();
      if (result.error || !result.data.session) throw new Error(CLOUD_RECONNECT_MESSAGE);
      return result.data.session;
    })();
    refreshing.set(client, pending);
  }
  try {
    const session = await pending;
    const active = await client.auth.getSession();
    if (session.user.id !== expected.user.id || active.data.session?.user.id !== expected.user.id)
      throw new Error(ACCOUNT_CHANGED);
    return session;
  } finally {
    if (refreshing.get(client) === pending) refreshing.delete(client);
  }
}

/** Auth verification is outside the fetch retry: Auth holds its own session lock. */
export async function verifyCloudSession(client: SupabaseClient, session: Session): Promise<void> {
  let result = await client.auth.getUser(session.access_token);
  if (isExpiredJwt(result.error)) {
    const renewed = await renewCloudSession(client, session);
    result = await client.auth.getUser(renewed.access_token);
  }
  if (result.error) {
    if (isExpiredJwt(result.error) || result.error.status === 401 || result.error.status === 403)
      throw new Error(CLOUD_RECONNECT_MESSAGE);
    throw new Error("Could not connect to Filey Cloud. Check your connection and try again.");
  }
  if (result.data.user?.id !== session.user.id) throw new Error(ACCOUNT_CHANGED);
}

/** A rejected JWT has not executed the database/storage operation. Retry that
 * request once, never a whole upload or an ambiguous network/server failure. */
export function sessionFetch(
  projectUrl: string,
  getClient: () => SupabaseClient | null,
  send: typeof fetch = (...args) => globalThis.fetch(...args),
): typeof fetch {
  const origin = new URL(projectUrl).origin;
  return async (input, init) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    // Never refresh inside Auth's fetch, cross origins, or replay consumed streams.
    if (target.origin !== origin || !/^\/(rest|storage)\/v1\//.test(target.pathname)
      || (typeof Request !== "undefined" && input instanceof Request)
      || (typeof ReadableStream !== "undefined" && init?.body instanceof ReadableStream))
      return send(input, init);
    const client = getClient();
    if (!client) return send(input, init);
    const headers = new Headers(init?.headers);
    const { data } = await client.auth.getSession();
    const session = data.session;
    const response = await send(input, init);
    if (!session || headers.get("Authorization") !== `Bearer ${session.access_token}`
      || ![401, 403].includes(response.status)) return response;
    let detail: unknown;
    try { detail = await response.clone().json(); } catch { return response; }
    if (!isExpiredJwt(detail)) return response;
    const renewed = await renewCloudSession(client, session);
    if (init?.signal?.aborted) return response;
    headers.set("Authorization", `Bearer ${renewed.access_token}`);
    const retried = await send(input, { ...init, headers });
    if ([401, 403].includes(retried.status)) {
      let error: unknown;
      try { error = await retried.clone().json(); } catch { return retried; }
      if (isExpiredJwt(error)) throw new Error(CLOUD_RECONNECT_MESSAGE);
    }
    return retried;
  };
}
