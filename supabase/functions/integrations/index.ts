// Integrations proxy — Composio and Zernio on FILEY's keys.
//
// Why a proxy at all: a platform API key cannot ship inside the desktop app.
// The binary is on the customer's machine, so anything baked into it can be
// read out of it, and then it is our Composio bill and our Zernio credits being
// spent by whoever extracted it. The key stays here, as a Supabase secret, and
// the app calls this function with the user's own session — the same shape as
// send-email and RESEND_API_KEY.
//
// Isolation: Composio identifies a customer's connected accounts by user_id, so
// every call passes the caller's Supabase user id. One platform key, one entity
// per customer, and nobody can reach anyone else's Gmail by asking nicely.
//
// Bring-your-own-key still works and bypasses this entirely (see lib/composio,
// lib/zernio) — that path is for offline installs and self-hosters.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";
const ZERNIO_BASE = "https://zernio.com/api/v1";

// Actions that cost real money get a daily ceiling per user. Reads are free.
// A social post is a public, permanent artefact and a tool execution can send
// email or move data — the free tier gets enough to evaluate the product, not
// enough to run a spam operation on our account.
const FREE_DAILY_ACTIONS = 25;
const PAID_DAILY_ACTIONS = 2000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Actions that spend money or leave something behind. */
const BILLABLE = new Set([
  "composio_execute",
  "composio_connect",
  "zernio_create_post",
  "zernio_delete_post",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { provider, action, payload } = await req.json();
    const op = `${provider}_${action}`;

    // verify_jwt=true means the platform already checked the signature, so the
    // sub claim can be trusted for identity and rate limiting.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let userId = "";
    try {
      userId = JSON.parse(atob(jwt.split(".")[1])).sub ?? "";
    } catch {
      /* rejected below */
    }
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // A cloud user can bring their own key (integration_keys, service-role
    // readable only). When they have, this call spends their credits, not
    // ours — so it skips the platform's daily ceiling entirely, the same way
    // the desktop's own-key path bypasses this function altogether.
    const { data: ownRow } = await supa
      .from("integration_keys")
      .select("api_key")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    const ownKey = (ownRow?.api_key as string | undefined)?.trim() || "";

    if (BILLABLE.has(op) && !ownKey) {
      // Same tier resolution as send-email: the org's plan decides the ceiling.
      let paid = false;
      const { data: prof } = await supa
        .from("profiles")
        .select("org_id")
        .eq("id", userId)
        .maybeSingle();
      const orgId = prof?.org_id as string | undefined;
      if (orgId && orgId !== "default") {
        const { data: org } = await supa
          .from("organizations")
          .select("plan, plan_status")
          .eq("id", orgId)
          .maybeSingle();
        const plan = org?.plan as string | undefined;
        const status = org?.plan_status as string | undefined;
        paid =
          !!plan &&
          plan !== "free" &&
          (status === "active" || status === "trialing" || status === "past_due");
      }
      const limit = paid ? PAID_DAILY_ACTIONS : FREE_DAILY_ACTIONS;
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await supa
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("action", "integration_action")
        .gte("created_at", dayAgo);
      if ((count ?? 0) >= limit)
        return json(
          {
            error: `Daily integration limit reached (${limit}/day).${
              paid ? "" : " Upgrade your plan for more."
            }`,
          },
          429
        );
    }

    const result =
      provider === "composio"
        ? await composio(action, payload ?? {}, userId, ownKey)
        : provider === "zernio"
          ? await zernio(action, payload ?? {}, ownKey)
          : { status: 400, body: { error: `Unknown provider: ${provider}` } };

    if (BILLABLE.has(op) && !ownKey && result.status < 400) {
      await supa.from("audit_log").insert({
        user_id: userId,
        actor: "user",
        action: "integration_action",
        entity: op,
        details: null,
      });
    }
    return json(result.body, result.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

interface Result {
  status: number;
  body: unknown;
}

async function callJson(
  url: string,
  init: RequestInit,
  missing: string
): Promise<Result> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    return {
      status: res.status,
      body: { error: (body as { message?: string })?.message ?? missing },
    };
  return { status: 200, body };
}

async function composio(
  action: string,
  payload: Record<string, unknown>,
  userId: string,
  ownKey = ""
): Promise<Result> {
  const key = ownKey || Deno.env.get("COMPOSIO_API_KEY");
  if (!key)
    return { status: 503, body: { error: "Integrations aren't configured yet." } };
  const headers = { "x-api-key": key, "Content-Type": "application/json" };

  if (action === "list")
    return callJson(
      // Scoped to the caller: without user_id this would return every
      // customer's connections on the platform account.
      `${COMPOSIO_BASE}/connected_accounts?limit=50&user_id=${encodeURIComponent(userId)}`,
      { headers },
      "Could not list connections"
    );

  if (action === "status") {
    const id = String(payload.connected_account_id ?? "");
    if (!id) return { status: 400, body: { error: "connected_account_id required" } };
    return callJson(
      `${COMPOSIO_BASE}/connected_accounts/${encodeURIComponent(id)}`,
      { headers },
      "Could not read connection status"
    );
  }

  if (action === "connect") {
    const toolkit = String(payload.toolkit ?? "").toLowerCase();
    if (!toolkit) return { status: 400, body: { error: "toolkit required" } };
    // Re-use the platform's managed auth config for this toolkit, creating one
    // the first time a customer asks for it.
    const found = await callJson(
      `${COMPOSIO_BASE}/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}&limit=1`,
      { headers },
      "Could not read auth configs"
    );
    if (found.status >= 400) return found;
    let acId = (found.body as { items?: { id?: string }[] })?.items?.[0]?.id;
    if (!acId) {
      const made = await callJson(
        `${COMPOSIO_BASE}/auth_configs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            toolkit: { slug: toolkit },
            auth_config: { type: "use_composio_managed_auth" },
          }),
        },
        "Could not create an auth config"
      );
      if (made.status >= 400) return made;
      acId = (made.body as { auth_config?: { id?: string } })?.auth_config?.id;
    }
    if (!acId) return { status: 502, body: { error: "No auth config for that app" } };
    return callJson(
      `${COMPOSIO_BASE}/connected_accounts/link`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ auth_config_id: acId, user_id: userId }),
      },
      "Could not start the connection"
    );
  }

  if (action === "execute") {
    const tool = String(payload.tool_slug ?? "");
    if (!tool) return { status: 400, body: { error: "tool_slug required" } };
    return callJson(
      `${COMPOSIO_BASE}/tools/execute/${encodeURIComponent(tool)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          arguments: payload.arguments ?? {},
          user_id: userId,
        }),
      },
      "The app rejected that action"
    );
  }

  if (action === "toolkits") {
    // The full catalogue, so a customer can connect the app they actually use
    // rather than only the ones we thought to list.
    const q = String(payload.query ?? "").trim();
    const n = Number(payload.limit ?? 20);
    return callJson(
      `${COMPOSIO_BASE}/toolkits?limit=${n}${q ? `&search=${encodeURIComponent(q)}` : ""}`,
      { headers },
      "Could not search apps"
    );
  }

  if (action === "tools") {
    // What can this customer actually do right now — the tools belonging to the
    // apps they have connected.
    const toolkits = String(payload.toolkits ?? "");
    const q = toolkits ? `&toolkit_slug=${encodeURIComponent(toolkits)}` : "";
    return callJson(
      `${COMPOSIO_BASE}/tools?limit=${Number(payload.limit ?? 40)}${q}`,
      { headers },
      "Could not list tools"
    );
  }

  return { status: 400, body: { error: `Unknown Composio action: ${action}` } };
}

async function zernio(
  action: string,
  payload: Record<string, unknown>,
  ownKey = ""
): Promise<Result> {
  const key = ownKey || Deno.env.get("ZERNIO_API_KEY");
  if (!key)
    return { status: 503, body: { error: "Social publishing isn't configured yet." } };
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const get = (path: string, missing: string) =>
    callJson(`${ZERNIO_BASE}${path}`, { headers }, missing);

  if (action === "accounts") return get("/accounts", "Could not list accounts");
  if (action === "profiles") return get("/profiles", "Could not list profiles");
  if (action === "posts")
    return get(`/posts?limit=${Number(payload.limit ?? 20)}`, "Could not list posts");
  if (action === "usage") return get("/usage", "Could not read usage");
  if (action === "create_post")
    return callJson(
      `${ZERNIO_BASE}/posts`,
      { method: "POST", headers, body: JSON.stringify(payload.input ?? {}) },
      "The post was rejected"
    );
  if (action === "delete_post") {
    const id = String(payload.post_id ?? "");
    if (!id) return { status: 400, body: { error: "post_id required" } };
    const res = await fetch(`${ZERNIO_BASE}/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    return res.ok
      ? { status: 200, body: { ok: true } }
      : { status: res.status, body: { error: "Could not delete that post" } };
  }
  return { status: 400, body: { error: `Unknown Zernio action: ${action}` } };
}
