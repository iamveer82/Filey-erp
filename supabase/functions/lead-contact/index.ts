// "I want Filey Freedom" — the buy button, while Stripe is out of the loop.
//
// Takes a name and a phone number from the pricing page (website) or the
// billing panel (app), records it in lead_requests and emails the owner through
// Resend. Deliberately the only public write path in the project.
//
// Deploy:  supabase functions deploy lead-contact --no-verify-jwt
//   (--no-verify-jwt: a website visitor has no Supabase session. That makes
//    this endpoint reachable by anyone, so it is rate limited by IP and every
//    field is length-capped and escaped before it goes anywhere near an email.)
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (already set for send-email).
//   Optional: LEAD_INBOX — where leads go (defaults to the owner's address).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_INBOX = "iamveer82@gmail.com";
/** Per-IP ceiling. Generous for a human, useless for a script. */
const MAX_PER_HOUR = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Escape before embedding anything a stranger typed into HTML email. */
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );

/** Trim, cap, and reject the empty string. */
const field = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const name = field(body.name, 120);
    const phone = field(body.phone, 40);
    const email = field(body.email, 200);
    const message = field(body.message, 1000);
    const source = body.source === "app" ? "app" : "website";

    if (!name || !phone)
      return json({ error: "Please give a name and a phone number." }, 400);
    // Cheap sanity check: a number needs digits. Format varies too much
    // internationally to demand more than that.
    if ((phone.match(/\d/g) ?? []).length < 6)
      return json({ error: "That phone number doesn't look right." }, 400);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supa
      .from("lead_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", hourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR)
      return json(
        { error: "We already have your request — we'll be in touch shortly." },
        429
      );

    const { data: row, error: ie } = await supa
      .from("lead_requests")
      .insert({ name, phone, email: email || null, message: message || null, source, ip })
      .select("id")
      .single();
    if (ie) return json({ error: ie.message }, 500);

    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") ?? "Filey <noreply@gofiley.com>";
    const to = Deno.env.get("LEAD_INBOX") ?? DEFAULT_INBOX;
    if (!key) {
      // The lead is saved either way — losing it because email is misconfigured
      // would be the worse failure.
      console.error("RESEND_API_KEY not set — lead saved but not emailed");
      return json({ ok: true, emailed: false });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        // Replying goes to the lead when they left an address.
        ...(email ? { reply_to: email } : {}),
        subject: `Filey Freedom — ${name} wants the plan`,
        html:
          `<div style="font-family:Arial,sans-serif;color:#222">` +
          `<h2 style="margin:0 0 12px">New Freedom plan request</h2>` +
          `<p style="margin:0 0 6px"><b>Name:</b> ${esc(name)}</p>` +
          `<p style="margin:0 0 6px"><b>Phone:</b> ${esc(phone)}</p>` +
          (email ? `<p style="margin:0 0 6px"><b>Email:</b> ${esc(email)}</p>` : "") +
          (message ? `<p style="margin:12px 0 6px"><b>Message:</b><br>${esc(message)}</p>` : "") +
          `<p style="margin:12px 0 0;color:#888;font-size:12px">` +
          `From the ${esc(source)} · lead #${row.id}</p></div>`,
      }),
    });

    if (!res.ok) {
      console.error("resend", res.status, await res.text().catch(() => ""));
      return json({ ok: true, emailed: false });
    }
    await supa.from("lead_requests").update({ emailed: true }).eq("id", row.id);
    return json({ ok: true, emailed: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
