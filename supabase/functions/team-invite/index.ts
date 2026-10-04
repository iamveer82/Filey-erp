// Deploy with --no-verify-jwt. Authentication and workspace authorization are
// checked here and in the caller-scoped RPC. Resend keys never reach the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mfaAllowed, MFA_REQUIRED } from "../_shared/mfa.ts";
import { CORS_HEADERS, json } from "../_shared/rateLimit.ts";
import { sendInvitation, type TeamInvitation } from "../_shared/team-invitation.ts";
import { BillingRequestError, readBillingBody } from "../_shared/billing-request.ts";

// Only deliberate business validation messages may be shown. SQL/client
// errors can contain statement values, private addresses or configuration.
const INVITATION_ERRORS = new Set([
  "Only a verified workspace owner or administrator can invite members", "Choose a workspace first",
  "Invitation is no longer pending", "Enter a valid email address", "Invalid member role",
  "Too many module permissions", "This person is already a workspace member",
  "Wait a minute before resending", "Workspace invitation limit reached. Try again tomorrow",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    let body;
    try { body=JSON.parse(await readBillingBody(req,16384)); }
    catch(error) { return json({error:error instanceof BillingRequestError?"Invitation request is too large":"Invalid invitation"},error instanceof BillingRequestError?413:400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({error:"Invalid invitation"},400);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: auth, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !auth.user?.email_confirmed_at)
      return json({ error: "Sign in with a verified email to invite teammates." }, 401);
    if (!mfaAllowed(auth.user, jwt)) return json(MFA_REQUIRED, 403);
    const key = Deno.env.get("RESEND_API_KEY") ?? "",
      from = Deno.env.get("EMAIL_FROM") ?? "";
    if (!key || !from)
      return json(
        {
          error:
            "Invitation email is not configured. Ask your administrator to configure Resend.",
        },
        503
      );
    if (
      body.invite !== undefined &&
      (typeof body.invite !== "string" || !/^[0-9a-f-]{36}$/i.test(body.invite))
    )
      return json({ error: "Invalid invitation" }, 400);
    if (body.resend !== undefined && typeof body.resend !== "boolean")
      return json({ error: "Invalid resend request" }, 400);
    if (
      body.invite === undefined &&
      (typeof body.email !== "string" || body.email.length>320 || typeof body.role !== "string" || body.role.length>40)
    )
      return json({ error: "Email and role are required" }, 400);
    if (
      body.modules != null &&
      (!Array.isArray(body.modules) ||
        body.modules.length > 100 ||
        body.modules.some((m: unknown) => typeof m !== "string" || m.length>128))
    )
      return json({ error: "Invalid permissions" }, 400);
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data, error } = await caller.rpc("filey_prepare_invitation", {
      p_email: body.email ?? null,
      p_role: body.role ?? "staff",
      p_modules: body.modules ?? null,
      p_invite: body.invite ?? null,
      p_resend: body.resend ?? false,
    });
    if (error) return json({ error: INVITATION_ERRORS.has(error.message)?error.message:"Could not prepare the invitation. Please retry." }, 400);
    const invite = data as TeamInvitation;
    if (invite.email_status === "accepted")
      return json({ id: invite.id, status: "accepted" });
    const delivery = await sendInvitation(invite, {
      key,
      from,
      appUrl: Deno.env.get("APP_URL") ?? "https://app.gofiley.com",
    });
    const { error: saveError } = await admin
      .from("invitations")
      .update({ email_status: delivery.status, email_error: delivery.error })
      .eq("id", invite.id)
      .eq("email_send_id", invite.email_send_id)
      .neq("email_status", "accepted");
    // Provider acceptance and our status write are separate operations. Don't
    // pretend a failed status write means the provider did not send the email.
    if (saveError)
      return json({
        id: invite.id,
        status: "unknown",
        error: "The email result could not be saved. Retry to check the same invitation.",
      });
    return json({ id: invite.id, ...delivery });
  } catch {
    return json({ error: "Could not prepare the invitation. Please retry." }, 500);
  }
});
