export interface TeamInvitation {
  id: string;
  email: string;
  email_send_id: string;
  email_status: string;
  workspace_name: string;
  role: string;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

export function invitationEmail(invite: TeamInvitation, appUrl: string) {
  const url = new URL(appUrl);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error("Invalid Filey app URL");
  url.hash = `/settings?section=users&invite=${encodeURIComponent(invite.id)}`;
  return {
    to: invite.email,
    subject: `Join ${invite.workspace_name.replace(/[\r\n]/g, " ").slice(0, 120)} on Filey`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#202020"><h1 style="font-size:24px">Your workspace is ready</h1><p>You have been invited to <strong>${escape(invite.workspace_name)}</strong> as ${escape(invite.role)}.</p><p><a href="${escape(url.href)}" style="display:inline-block;background:#ffd21f;color:#171717;border-radius:999px;padding:14px 24px;text-decoration:none">Review invitation</a></p><p>Sign in or create a Filey account with ${escape(invite.email)}, then choose Accept invitation. This link expires after seven days.</p><p style="color:#666;font-size:13px">If you were not expecting this invitation, you can ignore this email. Joining does not move your existing records.</p></div>`,
  };
}

/** A retry uses one provider key. A timeout is unknown, never a delivered email. */
export async function sendInvitation(
  invite: TeamInvitation,
  config: { key: string; from: string; appUrl: string },
  send: typeof fetch = fetch
) {
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `filey-invite/${invite.email_send_id}`,
      },
      body: JSON.stringify({
        from: config.from,
        ...invitationEmail(invite, config.appUrl),
      }),
    });
    if (!response.ok)
      return {
        status: response.status >= 500 || response.status === 409 ? "unknown" : "failed",
        error:
          "The email provider could not confirm this invitation. Retry from Pending invitations.",
      };
    return { status: "accepted", error: null };
  } catch {
    return {
      status: "unknown",
      error: "Email delivery could not be confirmed. Retry from Pending invitations.",
    };
  }
}
