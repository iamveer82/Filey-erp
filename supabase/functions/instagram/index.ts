// Instagram automation -- management API for the desktop app.
//
// The desktop app calls this with the user's own Supabase session; tokens and
// Graph calls never reach the client.
//
//   supabase functions deploy instagram
//
// Actions (POST): status | connect_url | disconnect | list | media | save |
// toggle | duplicate | delete | events | refresh. See src/lib/instagram.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BillingRequestError, readBillingBody } from "../_shared/billing-request.ts";
import { marketingJson, requireMarketing } from "../_shared/require-marketing.ts";
import { validateAutomationInput } from "../_shared/instagram-core.ts";

const GRAPH_VERSION = Deno.env.get("IG_GRAPH_VERSION") ?? "v26.0";
const IG_FUNCTION_BASE = () =>
  (Deno.env.get("IG_FUNCTION_BASE") ??
    Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".functions.supabase.co")
  ).replace(/\/$/, "");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const uuidish = (v: unknown): string => (typeof v === "string" ? v.trim() : "").slice(0, 80);

interface Context {
  supa: SupabaseClient;
  orgId: string;
  userId: string;
  json: typeof marketingJson;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  if (req.method !== "POST") return marketingJson({ error: "Method not allowed." }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await readBillingBody(req, 1_048_576);
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!isRecord(parsed)) throw new Error();
    body = parsed;
  } catch (error) {
    return error instanceof BillingRequestError
      ? marketingJson({ error: "Request is too large." }, 413)
      : marketingJson({ error: "Invalid JSON body." }, 400);
  }

  const action = str(body.action);
  if (!/^[a-z_]{2,32}$/.test(action)) return marketingJson({ error: "Choose a valid action." }, 400);

  const ctx = await requireMarketing(req, "instagram");
  if (ctx instanceof Response) return ctx;
  const { json } = ctx;

  // Reviewed-workspace binding: a cross-tab switch must never retarget this call.
  if (body.expected_org_id !== undefined) {
    const expected = str(body.expected_org_id);
    if (!expected || expected !== ctx.orgId)
      return json({ error: "Workspace changed. Reopen the Marketing page." }, 409);
  }

  try {
    switch (action) {
      case "status": return await listConnections(ctx);
      case "connect_url": return await connectUrl(ctx);
      case "disconnect": return await disconnect(ctx, body);
      case "list": return await listAutomations(ctx);
      case "media": return await media(ctx, body);
      case "save": return await save(ctx, body);
      case "toggle": return await toggle(ctx, body);
      case "duplicate": return await duplicateAutomation(ctx, body);
      case "delete": return await deleteAutomation(ctx, body);
      case "events": return await events(ctx, body);
      case "refresh": return await refresh(ctx, body);
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    console.error("instagram", action, error instanceof Error ? error.message : error);
    return json({ error: "Instagram automation is temporarily unavailable. Check whether the action completed before trying again." }, 500);
  }
});

async function listConnections(ctx: Context) {
  const { data, error } = await ctx.supa
    .from("ig_connections")
    .select("id, ig_user_id, ig_username, account_type, token_expires_at, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const now = Date.now();
  return ctx.json({
    connections: (data ?? []).map((row) => ({
      id: row.id,
      ig_user_id: row.ig_user_id,
      ig_username: row.ig_username,
      account_type: row.account_type,
      connected_at: row.created_at,
      needs_reconnect: !row.token_expires_at || Date.parse(row.token_expires_at) <= now,
    })),
  });
}

async function connectUrl(ctx: Context) {
  if (!Deno.env.get("IG_APP_ID") || !Deno.env.get("IG_APP_SECRET"))
    return ctx.json({ error: "Instagram isn't configured on the server yet. Ask the Filey administrator to set IG_APP_ID and IG_APP_SECRET." }, 503);
  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = [...stateBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await ctx.supa.from("ig_oauth_states").insert({
    state,
    org_id: ctx.orgId,
    user_id: ctx.userId,
  });
  if (error) throw error;
  return ctx.json({ url: `${IG_FUNCTION_BASE()}/instagram-auth?action=start&state=${encodeURIComponent(state)}` });
}

async function disconnect(ctx: Context, body: Record<string, unknown>) {
  const id = uuidish(body.connection_id);
  if (!id) return ctx.json({ error: "Choose an account to disconnect." }, 400);
  const { data, error } = await ctx.supa
    .from("ig_connections")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return ctx.json({ error: "That account is not connected in this workspace." }, 404);
  return ctx.json({ ok: true });
}

async function connectionFor(
  ctx: Context,
  connectionId: string
) {
  const { data, error } = await ctx.supa
    .from("ig_connections")
    .select("id, access_token, token_expires_at, ig_username")
    .eq("id", connectionId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function graphGet(token: string, path: string) {
  const url = path.startsWith("http") ? path : `https://graph.instagram.com/${GRAPH_VERSION}${path}`;
  const glue = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${glue}access_token=${encodeURIComponent(token)}`, { redirect: "error" });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function listAutomations(ctx: Context) {
  const { data: automations, error } = await ctx.supa
    .from("ig_automations")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = automations ?? [];
  const ids = rows.map((r) => r.id as string);

  // Stats over the trailing 90 days.
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const counts = new Map<string, { sent: number; publicReplies: number }>();
  if (ids.length) {
    const { data: eventRows } = await ctx.supa
      .from("ig_events")
      .select("automation_id, kind")
      .eq("org_id", ctx.orgId)
      .in("automation_id", ids)
      .in("kind", ["dm_sent", "public_reply"])
      .gte("created_at", since);
    for (const row of eventRows ?? []) {
      const agg = counts.get(row.automation_id as string) ?? { sent: 0, publicReplies: 0 };
      if (row.kind === "dm_sent") agg.sent++;
      else agg.publicReplies++;
      counts.set(row.automation_id as string, agg);
    }
  }
  const clickSums = new Map<string, number>();
  if (ids.length) {
    const { data: linkRows } = await ctx.supa
      .from("ig_tracked_links")
      .select("automation_id, clicks")
      .eq("org_id", ctx.orgId)
      .in("automation_id", ids);
    for (const row of linkRows ?? []) {
      clickSums.set(
        row.automation_id as string,
        (clickSums.get(row.automation_id as string) ?? 0) + (Number(row.clicks) || 0)
      );
    }
  }

  return ctx.json({
    automations: rows.map((row) => ({
      id: row.id,
      connection_id: row.connection_id,
      name: row.name,
      trigger_type: row.trigger_type,
      keywords: row.keywords ?? [],
      exclude_keywords: row.exclude_keywords ?? [],
      match_mode: row.match_mode,
      typo_tolerance: row.typo_tolerance === true,
      platform_post_id: row.platform_post_id ?? null,
      dm_message: row.dm_message,
      dm_message_variations: row.dm_message_variations ?? [],
      buttons: row.buttons ?? [],
      dm_delay_seconds: row.dm_delay_seconds ?? 0,
      comment_reply: row.comment_reply ?? null,
      comment_reply_variations: row.comment_reply_variations ?? [],
      comment_reply_delay_seconds: row.comment_reply_delay_seconds ?? 0,
      public_reply_policy: row.public_reply_policy,
      follow_gate: row.follow_gate === true,
      also_match_in_dms: row.also_match_in_dms === true,
      repeat_mode: row.repeat_mode,
      cooldown_hours: row.cooldown_hours ?? null,
      dedupe_same_text_hours: row.dedupe_same_text_hours ?? null,
      is_active: row.is_active === true,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        sent: counts.get(row.id as string)?.sent ?? 0,
        publicReplies: counts.get(row.id as string)?.publicReplies ?? 0,
        linkClicks: clickSums.get(row.id as string) ?? 0,
      },
    })),
  });
}

async function media(ctx: Context, body: Record<string, unknown>) {
  const connectionId = uuidish(body.connection_id);
  const connection = await connectionFor(ctx, connectionId);
  if (!connection) return ctx.json({ error: "Connection not found in this workspace." }, 404);
  const limit = Math.min(Math.max(Number(body.limit) || 24, 1), 50);
  const result = await graphGet(
    connection.access_token,
    `me/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=${limit}`
  );
  if (!result.ok) {
    const code = (result.body as { error?: { code?: number } } | null)?.error?.code;
    return ctx.json(
      {
        error: code === 190
          ? "The Instagram connection expired. Reconnect it and try again."
          : "Could not load the connected account's posts.",
      },
      502
    );
  }
  const items = (result.body as { data?: unknown[] } | null)?.data ?? [];
  return ctx.json({ items });
}

async function save(ctx: Context, body: Record<string, unknown>) {
  const connectionId = uuidish(body.connection_id);
  const connection = await connectionFor(ctx, connectionId);
  if (!connection) return ctx.json({ error: "Connect the Instagram account first." }, 400);

  const checked = validateAutomationInput(body.automation ?? body);
  if (!checked.ok) return ctx.json({ error: checked.errors[0], errors: checked.errors }, 400);
  const value = checked.value;
  const now = new Date().toISOString();

  const row = {
    org_id: ctx.orgId,
    connection_id: connectionId,
    name: value.name,
    trigger_type: value.trigger_type,
    keywords: value.keywords,
    exclude_keywords: value.exclude_keywords,
    match_mode: value.match_mode,
    typo_tolerance: value.typo_tolerance,
    platform_post_id: value.platform_post_id,
    dm_message: value.dm_message,
    dm_message_variations: value.dm_message_variations,
    buttons: value.buttons,
    dm_delay_seconds: value.dm_delay_seconds,
    comment_reply: value.comment_reply,
    comment_reply_variations: value.comment_reply_variations,
    comment_reply_delay_seconds: value.comment_reply_delay_seconds,
    public_reply_policy: value.public_reply_policy,
    follow_gate: value.follow_gate,
    also_match_in_dms: value.also_match_in_dms,
    repeat_mode: value.repeat_mode,
    cooldown_hours: value.cooldown_hours,
    dedupe_same_text_hours: value.dedupe_same_text_hours,
    is_active: value.is_active,
    updated_at: now,
  };

  const automationId = uuidish(body.id);
  let savedId: string;
  if (automationId) {
    const { data, error } = await ctx.supa
      .from("ig_automations")
      .update(row)
      .eq("id", automationId)
      .eq("org_id", ctx.orgId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return ctx.json({ error: "Automation not found in this workspace." }, 404);
    savedId = data.id as string;
  } else {
    const { data, error } = await ctx.supa
      .from("ig_automations")
      .insert({ ...row, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw error;
    savedId = data.id as string;
  }

  // Sync tracked links to the URL buttons, one row per button index.
  const { data: existing } = await ctx.supa
    .from("ig_tracked_links")
    .select("id, button_index")
    .eq("automation_id", savedId);
  const keepIndexes = new Set(value.buttons.map((_, index) => index));
  const stale = (existing ?? []).filter((r) => !keepIndexes.has(r.button_index as number));
  if (stale.length)
    await ctx.supa.from("ig_tracked_links").delete().in("id", stale.map((r) => r.id));
  for (const [index, button] of value.buttons.entries()) {
    const current = (existing ?? []).find((r) => r.button_index === index);
    if (current) {
      await ctx.supa
        .from("ig_tracked_links")
        .update({ target_url: button.url, tracked: true })
        .eq("id", current.id);
    } else {
      await ctx.supa.from("ig_tracked_links").insert({
        org_id: ctx.orgId,
        automation_id: savedId,
        button_index: index,
        target_url: button.url,
        tracked: true,
      });
    }
  }

  return ctx.json({ ok: true, id: savedId });
}

async function toggle(ctx: Context, body: Record<string, unknown>) {
  const id = uuidish(body.id);
  if (!id) return ctx.json({ error: "Choose an automation." }, 400);
  const isActive = body.is_active === true;
  const { data, error } = await ctx.supa
    .from("ig_automations")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return ctx.json({ error: "Automation not found in this workspace." }, 404);
  return ctx.json({ ok: true, is_active: isActive });
}

async function duplicateAutomation(ctx: Context, body: Record<string, unknown>) {
  const id = uuidish(body.id);
  const { data: source, error } = await ctx.supa
    .from("ig_automations")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!source) return ctx.json({ error: "Automation not found in this workspace." }, 404);

  const { id: _id, created_at: _c, updated_at: _u, ...rest } = source as Record<string, unknown>;
  const { data: copy, error: insertError } = await ctx.supa
    .from("ig_automations")
    .insert({
      ...rest,
      name: `${String(source.name).slice(0, 108)} (copy)`,
      is_active: false,
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const { data: links } = await ctx.supa
    .from("ig_tracked_links")
    .select("button_index, target_url")
    .eq("automation_id", id)
    .eq("org_id", ctx.orgId);
  if (links?.length)
    await ctx.supa.from("ig_tracked_links").insert(
      links.map((link) => ({
        org_id: ctx.orgId,
        automation_id: copy.id,
        button_index: link.button_index,
        target_url: link.target_url,
      }))
    );

  return ctx.json({ ok: true, id: copy.id });
}

async function deleteAutomation(ctx: Context, body: Record<string, unknown>) {
  const id = uuidish(body.id);
  const { data, error } = await ctx.supa
    .from("ig_automations")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return ctx.json({ error: "Automation not found in this workspace." }, 404);
  return ctx.json({ ok: true });
}

async function events(ctx: Context, body: Record<string, unknown>) {
  const automationId = uuidish(body.automation_id);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  let query = ctx.supa
    .from("ig_events")
    .select("id, automation_id, connection_id, kind, actor_igsid, actor_username, comment_id, detail, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (automationId) query = query.eq("automation_id", automationId);
  const { data, error } = await query;
  if (error) throw error;

  const { data: automations } = await ctx.supa
    .from("ig_automations")
    .select("id, name")
    .eq("org_id", ctx.orgId);
  const names = new Map((automations ?? []).map((row) => [row.id, row.name]));

  return ctx.json({
    events: (data ?? []).map((row) => ({
      ...row,
      automation_name: row.automation_id ? names.get(row.automation_id) ?? null : null,
    })),
  });
}

async function refresh(ctx: Context, body: Record<string, unknown>) {
  const connectionId = uuidish(body.connection_id);
  const connection = await connectionFor(ctx, connectionId);
  if (!connection) return ctx.json({ error: "Connection not found in this workspace." }, 404);
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(connection.access_token)}`,
    { redirect: "error" }
  );
  const bodyJson = await res.json().catch(() => null) as Record<string, unknown> | null;
  const token = typeof bodyJson?.access_token === "string" ? bodyJson.access_token : "";
  const expiresIn = Number(bodyJson?.expires_in) || 60 * 24 * 3600;
  if (!res.ok || !token)
    return ctx.json({ error: "Instagram refused the token refresh. Reconnect the account instead." }, 502);
  const { error } = await ctx.supa
    .from("ig_connections")
    .update({
      access_token: token,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("org_id", ctx.orgId);
  if (error) throw error;
  return ctx.json({ ok: true, needs_reconnect: false });
}
