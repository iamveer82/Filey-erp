// Instagram Business Login — OAuth start + callback.
//
// Public by necessity: Meta and the user's browser both land here without a
// Supabase JWT. Trust comes from the `state` row written by the start action
// and from Meta's own signed code exchange; nothing is accepted from the URL
// except `state`, `code` and Meta's `error` field.
//
//   supabase functions deploy instagram-auth --no-verify-jwt
//
// Secrets:
//   IG_APP_ID        Meta app's "Instagram app ID" (App → Instagram → API setup)
//   IG_APP_SECRET    Meta app secret — REQUIRED; also used to verify webhooks
//   IG_FUNCTION_BASE optional override, defaults to <project>.functions.supabase.co
//
// Register this exact redirect_uri in the Meta app:
//   https://<project>.functions.supabase.co/instagram-auth?action=callback

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("IG_GRAPH_VERSION") ?? "v26.0";
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
].join(",");
/** Events instagram-webhook handles; story replies and mentions arrive as messages. */
const WEBHOOK_FIELDS = "comments,live_comments,messages,messaging_postbacks";

const html = (title: string, heading: string, body: string, ok: boolean) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #faf9f7; color: #1c1917; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
  main { max-width: 30rem; background: #fff; border: 1px solid #e7e5e4; border-radius: 16px;
         padding: 28px 26px; box-shadow: 0 12px 40px rgba(0,0,0,.06); }
  .mark { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
          background: ${ok ? "#ecfdf5" : "#fef2f2"}; color: ${ok ? "#047857" : "#b91c1c"};
          font-size: 22px; font-weight: 700; margin-bottom: 14px; }
  h1 { font-size: 17px; margin: 0 0 8px; }
  p { margin: 0; color: #57534e; }
  a { color: #0369a1; }
  code { background: #f5f5f4; border-radius: 6px; padding: 1px 5px; font-size: 12px; }
</style></head><body><main>
<div class="mark">${ok ? "&check;" : "!"}</div><h1>${escapeHtml(heading)}</h1><p>${body}</p>
</main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

const env = (name: string): string => (Deno.env.get(name) ?? "").trim();

const functionBase = (): string => {
  const override = env("IG_FUNCTION_BASE");
  if (override) return override.replace(/\/$/, "");
  // <ref>.supabase.co → <ref>.functions.supabase.co
  return env("SUPABASE_URL").replace(".supabase.co", ".functions.supabase.co").replace(/\/$/, "");
};

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });
  const url = new URL(req.url);
  const appId = env("IG_APP_ID");
  const appSecret = env("IG_APP_SECRET");
  if (!appId || !appSecret)
    return html("Not configured", "Instagram isn't configured yet",
      "The Filey server is missing the Instagram app credentials. Ask the Filey administrator to set <code>IG_APP_ID</code> and <code>IG_APP_SECRET</code>, or use Settings → Integrations to report it.",
      false);

  const redirectUri = `${functionBase()}/instagram-auth?action=callback`;
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (url.searchParams.get("action") === "start") {
    const state = url.searchParams.get("state") ?? "";
    const { data } = await supa
      .from("ig_oauth_states")
      .select("state")
      .eq("state", state)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data)
      return html("Link expired", "That connect link expired",
        "It only works for 15 minutes. Go back to Filey and press <strong>Connect Instagram</strong> again.", false);
    const authorize = new URL("https://www.instagram.com/oauth/authorize");
    authorize.searchParams.set("client_id", appId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", SCOPES);
    authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.searchParams.get("action") === "callback") {
    // Meta shows "User cancelled" in the URL; don't touch the DB for that.
    const metaError = url.searchParams.get("error");
    if (metaError)
      return html("Connection cancelled", "Connection cancelled",
        "You didn't approve access, so nothing was connected. You can try again from Filey any time.", false);

    const state = (url.searchParams.get("state") ?? "").trim();
    const code = (url.searchParams.get("code") ?? "").trim();
    const { data: stateRow } = await supa
      .from("ig_oauth_states")
      .select("state, org_id, user_id")
      .eq("state", state)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!stateRow)
      return html("Link expired", "That connect link expired",
        "Go back to Filey and press <strong>Connect Instagram</strong> again.", false);

    // Code → short-lived token (valid 1 hour).
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
      redirect: "error",
    });
    const shortBody = await shortRes.json().catch(() => null) as Record<string, unknown> | null;
    const shortToken = typeof shortBody?.access_token === "string" ? shortBody.access_token : "";
    if (!shortRes.ok || !shortToken)
      return html("Connection failed", "Instagram didn't approve the connection",
        "The authorization code was refused. Try again; if it keeps failing, check that the Instagram account is a <strong>Business or Creator</strong> account.", false);

    // Short-lived → long-lived (60 days).
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortToken)}`,
      { redirect: "error" }
    );
    const longBody = await longRes.json().catch(() => null) as Record<string, unknown> | null;
    const longToken = typeof longBody?.access_token === "string" ? longBody.access_token : "";
    const expiresIn = Number(longBody?.expires_in) || 60 * 24 * 3600;
    if (!longRes.ok || !longToken)
      return html("Connection failed", "Couldn't extend the Instagram session",
        "Meta refused the long-lived exchange. Try connecting again from Filey.", false);

    // Who is this? /me gives the professional account's own ids.
    const meRes = await fetch(
      `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(longToken)}`,
      { redirect: "error" }
    );
    const me = await meRes.json().catch(() => null) as Record<string, unknown> | null;
    const igUserId = String(me?.user_id ?? me?.id ?? "");
    const username = typeof me?.username === "string" ? me.username : "";
    const accountType = typeof me?.account_type === "string" ? me.account_type : "";
    if (!meRes.ok || !igUserId)
      return html("Connection failed", "Couldn't read the Instagram profile",
        "Meta accepted the login but refused the profile read. Make sure this is a <strong>professional</strong> account (Business or Creator), not a personal one.", false);

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const { error: upsertError } = await supa.from("ig_connections").upsert(
      {
        org_id: stateRow.org_id,
        ig_user_id: igUserId,
        ig_username: username,
        account_type: accountType,
        access_token: longToken,
        token_expires_at: expiresAt,
        connected_by: stateRow.user_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ig_user_id" }
    );
    // The state is single-use either way.
    await supa.from("ig_oauth_states").delete().eq("state", state);
    if (upsertError)
      return html("Connection failed", "Couldn't save the connection",
        "The database refused the row. Try again, or ask the Filey administrator to check <code>ig_connections</code>.", false);

    // Without this Meta delivers no webhooks for the account: comments, story replies
    // and button taps would never reach instagram-webhook.
    const subRes = await fetch(
      `https://graph.instagram.com/${GRAPH_VERSION}/me/subscribed_apps?subscribed_fields=${WEBHOOK_FIELDS}&access_token=${encodeURIComponent(longToken)}`,
      { method: "POST", redirect: "error" }
    );
    const subBody = await subRes.json().catch(() => null) as Record<string, unknown> | null;
    if (!subRes.ok || subBody?.success !== true)
      return html("Almost connected", "Instagram is linked, but not listening yet",
        `<strong>@${escapeHtml(username || "your account")}</strong> was saved, but Instagram refused to send its comments to Filey. Press <strong>Connect Instagram</strong> again in Filey.`, false);

    return html("Instagram connected", "Instagram is connected",
      `<strong>@${escapeHtml(username || "your account")}</strong> is linked to Filey. Return to Filey — the Instagram DM tab will refresh by itself in a few seconds.`,
      true);
  }

  return new Response("not found", { status: 404 });
});
