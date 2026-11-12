// Instagram DM link buttons: count the tap, then send the person on.
//
//   supabase functions deploy ig-track --no-verify-jwt
//   supabase secrets set IG_TRACK_URL=https://<project>.functions.supabase.co/ig-track
//
// Public on purpose (Instagram users tap these links). It only ever redirects to
// a URL saved on an automation's button, found by its random id, so it cannot be
// used as an open redirect.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  new Response("This link is no longer available.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed.", { status: 405 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return notFound();
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: link } = await supa
    .from("ig_tracked_links")
    .select("id, org_id, target_url, clicks")
    .eq("id", id)
    .maybeSingle();
  const target = typeof link?.target_url === "string" ? link.target_url : "";
  if (!/^https?:\/\//i.test(target)) return notFound();
  // Link previews fetch with HEAD; only a real visit counts.
  if (req.method === "GET") {
    // ponytail: read-then-write can drop a click under simultaneous taps; the click log is exact.
    await supa.from("ig_link_clicks").insert({ link_id: link!.id, org_id: link!.org_id });
    await supa.from("ig_tracked_links").update({ clicks: (Number(link!.clicks) || 0) + 1 }).eq("id", link!.id);
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
