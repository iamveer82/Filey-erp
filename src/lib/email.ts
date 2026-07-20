import { supabase, invokeFn } from "./supabase";
import { checkEmailDailyCap, bumpEmailCount } from "./license";

export interface EmailAttachment {
  /** File name shown in the email, e.g. "INV-1001.pdf". */
  filename: string;
  /** Base64-encoded file bytes (no `data:` prefix). */
  content: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

/** Base64-encode raw bytes for use as an EmailAttachment `content`. Chunked so
 *  large PDFs don't blow the call stack via String.fromCharCode(...spread). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Send one HTML email through Resend via the Supabase `send-email` Edge
 * Function (from noreply@gofiley.com). The API key stays server-side. Every
 * user — free-cloud and paid-offline alike — has cloud API access, so this is
 * the only send path (no local SMTP). */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!msg.to.trim()) throw new Error("No recipient email address.");
  if (!supabase)
    throw new Error("Email is not available — sign in to send.");

  // Per-tier daily cap (cloud sends are also capped server-side in the
  // send-email edge fn).
  await checkEmailDailyCap();

  const { error } = (await invokeFn(supabase, "send-email", {
    body: {
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      attachments: msg.attachments,
    },
  })) as { error: { message: string } | null };
  if (error)
    throw new Error(
      "Could not send email. Make sure the send-email function is deployed " +
        `and RESEND_API_KEY is set. (${error.message})`
    );
  await bumpEmailCount();
}

/** Escape a user-supplied value before embedding it in email HTML.
 * Prevents HTML/script injection from customer names, notes, etc. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal branded HTML wrapper for transactional emails. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
 <div style="background:#FFD600;padding:18px 24px;border-radius:12px 12px 0 0">
 <strong style="font-size:18px">${esc(title)}</strong>
 </div>
 <div style="border:1px solid #E4DAC6;border-top:0;border-radius:0 0 12px 12px;padding:24px;background:#fff">
 ${bodyHtml}
 <p style="color:#B6BAC1;font-size:12px;margin-top:24px">
 Sent via Filey ERP
 </p>
 </div>
 </div>`;
}
