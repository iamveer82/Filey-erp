// Enterprise inquiries and legacy Freedom plan requests.
//
// Takes a name and a phone number from the pricing page (website) or the
// billing panel (app), records it in lead_requests and emails the owner through
// Resend. Public requests are validated and rate limited.
//
// Deploy:  supabase functions deploy lead-contact --no-verify-jwt
//   (--no-verify-jwt: a website visitor has no Supabase session. That makes
//    this endpoint reachable by anyone, so it is rate limited by IP and every
//    field is length-capped and escaped before it goes anywhere near an email.)
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (already set for send-email).
//   Optional: LEAD_INBOX — where leads go (defaults to the owner's address).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BillingRequestError, readBillingBody } from "../_shared/billing-request.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { acceptedEmailId } from "../_shared/email-delivery.ts";

const DEFAULT_INBOX = "iamveer82@gmail.com";
/** Per-IP ceiling. Generous for a human, useless for a script. */
const MAX_PER_HOUR = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

/** Mint a single-use coupon code for the offline license. Unguessable by
 *  construction: 20 characters from a 30-symbol alphabet (look-alikes 0/O/1/I
 *  excluded) is ~98 bits of randomness — nothing like the old FILEY25. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generateCouponCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += ALPHABET[b % ALPHABET.length];
  return `FL-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`;
}

/** How long an unredeemed coupon stays alive. */
const COUPON_TTL_DAYS = 30;

export async function handleLead(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    let body;
    try { body=JSON.parse(await readBillingBody(req,16384)); }
    catch(error) { return json({error:error instanceof BillingRequestError?"Inquiry request is too large":"Invalid inquiry"},error instanceof BillingRequestError?413:400); }
    if (!body || typeof body!=="object" || Array.isArray(body)
      || typeof body.name!=="string" || typeof body.phone!=="string"
      || (body.email!==undefined && typeof body.email!=="string")
      || (body.message!==undefined && typeof body.message!=="string")) return json({error:"Invalid inquiry"},400);
    const name = field(body.name, 120);
    const phone = field(body.phone, 40);
    const email = field(body.email, 200);
    const message = field(body.message, 1000);
    const source = body.source === "app" ? "app" : "website";
    if (body.purpose !== undefined && body.purpose !== "enterprise" && body.purpose !== "freedom")
      return json({ error: "Unknown inquiry type." }, 400);
    const suppliedRequest=body.request_id??req.headers.get("idempotency-key");
    if((body.request_id!==undefined || suppliedRequest!==null)&&suppliedRequest!==undefined
      && (typeof suppliedRequest!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedRequest)))
      return json({error:"Invalid inquiry request"},400);
    if(body.request_id!==undefined && req.headers.has("idempotency-key") && body.request_id!==req.headers.get("idempotency-key"))
      return json({error:"Conflicting inquiry request"},400);
    const requestId=suppliedRequest??crypto.randomUUID();
    const enterprise = body.purpose === "enterprise";
    const plan = enterprise ? "Enterprise" : "Freedom";

    if (!name || !phone)
      return json({ error: "Please give a name and a phone number." }, 400);
    // Cheap sanity check: a number needs digits. Format varies too much
    // internationally to demand more than that.
    if ((phone.match(/\d/g) ?? []).length < 6)
      return json({ error: "That phone number doesn't look right." }, 400);

    const ip = (
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown").slice(0,128);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Reserve before insert/provider calls. Read-then-count allowed parallel
    // requests to all see zero leads and mint/send past the intended ceiling.
    let allowed;
    try { allowed=await rateLimit(supa,`lead-ip:${ip}`,"lead_contact",MAX_PER_HOUR,3600); }
    catch { return json({error:"We couldn't send your request. Please try again shortly."},503); }
    if (!allowed)
      return json(
        { error: "We already have your request — we'll be in touch shortly." },
        429
      );

    // ── Mint the lead's single-use coupon ──────────────────────────────────
    // One code per lead, one redemption per code, dead in 30 days if unused.
    // The code goes to the OWNER (email + in-app notification) — the visitor
    // gets it after payment, which for now is a conversation, not a gateway.
    const proposedCode = enterprise ? null : generateCouponCode();
    const proposedExpiry = enterprise ? null : new Date(
      Date.now() + COUPON_TTL_DAYS * 24 * 3_600_000
    ).toISOString();
    const {data:row,error:setupError}=await supa.rpc("filey_record_lead",{
      p_request:requestId,p_name:name,p_phone:phone,p_email:email||null,p_message:message||null,
      p_source:source,p_ip:ip,p_plan:enterprise?"enterprise":"freedom",p_code:proposedCode,p_expires_at:proposedExpiry,
    });
    if(setupError || !row || typeof row!=="object" || !Number.isSafeInteger(row.id) || row.id<1
      || typeof row.emailed!=="boolean"
      || (!enterprise && (typeof row.code!=="string" || typeof row.expires_at!=="string")))
      return json({error:"We couldn't save your request. Please try again shortly."},500);
    if(row.emailed) return json({ok:true,emailed:true});
    // Replays use the persisted coupon and expiry, never the new random proposal.
    const code: string|null=enterprise?null:row.code;
    const expiresAt: string|null=enterprise?null:row.expires_at;

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
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key":`filey-lead/${row.id}` },
      body: JSON.stringify({
        from,
        to,
        // Replying goes to the lead when they left an address.
        ...(email ? { reply_to: email } : {}),
        subject: `Filey ${plan} — ${name.replace(/[\r\n]/g," ")} wants to talk`,
        html:
          `<div style="font-family:Arial,sans-serif;color:#222">` +
          `<h2 style="margin:0 0 12px">New ${plan} inquiry</h2>` +
          (code ? `<div style="margin:0 0 14px;padding:12px 16px;background:#FFF8E1;border:1px solid #F0D060;border-radius:8px">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#666">SINGLE-USE COUPON (expires ${expiresAt!.slice(0, 10)}) — send after payment:</p>` +
          `<p style="margin:0;font-size:20px;font-weight:bold;letter-spacing:1px">${esc(code)}</p>` +
          `</div>` : "") +
          `<p style="margin:0 0 6px"><b>Name:</b> ${esc(name)}</p>` +
          `<p style="margin:0 0 6px"><b>Phone:</b> ${esc(phone)}</p>` +
          (email ? `<p style="margin:0 0 6px"><b>Email:</b> ${esc(email)}</p>` : "") +
          (message ? `<p style="margin:12px 0 6px"><b>Message:</b><br>${esc(message)}</p>` : "") +
          `<p style="margin:12px 0 0;color:#888;font-size:12px">` +
          `From the ${esc(source)} · lead #${row.id}</p></div>`,
      }),
    });

    if (!res.ok || !acceptedEmailId(await res.json().catch(()=>null))) {
      console.error("Lead notification email acceptance was not confirmed",res.status);
      return json({ ok: true, emailed: false });
    }
    const savedEmail=await supa.from("lead_requests").update({ emailed: true }).eq("id", row.id);
    if(savedEmail.error) console.error("Lead email acceptance status could not be saved");
    return json({ ok: true, emailed: true });
  } catch {
    return json({ error: "Your request could not be completed. Please try again shortly." }, 500);
  }
}
