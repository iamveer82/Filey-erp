import { invoke } from "@tauri-apps/api/core";
import { supabase, invokeFn } from "./supabase";
import { checkEmailDailyCap, bumpEmailCount } from "./license";

export interface EmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
}

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

const KEY = "email_config";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const emailConfigured = (c: EmailConfig | null): c is EmailConfig =>
  !!c && !!c.host && !!c.port && !!c.username && !!c.password;

export async function loadEmailConfig(): Promise<EmailConfig | null> {
  // SMTP credentials only ever live in the desktop app's encrypted store.
  // We never persist them in browser localStorage (plaintext, readable by
  // any script/XSS and other OS users on a shared machine).
  if (!hasDesktop) return null;
  try {
    const v = await invoke<string | null>("cache_get", { key: KEY });
    return v ? (JSON.parse(v) as EmailConfig) : null;
  } catch (e) {
    console.error("Failed to load email config", e);
    return null;
  }
}

export async function saveEmailConfig(c: EmailConfig): Promise<void> {
  if (!hasDesktop)
    throw new Error(
      "Email/SMTP setup is available in the Filey desktop app only — " +
        "credentials are never stored in the browser."
    );
  await invoke("cache_set", { key: KEY, value: JSON.stringify(c) });
}

/** Send one HTML email. Cloud-first: every user (free-cloud and paid-offline)
 * has cloud API access, so invoices go out via the Supabase `send-email` Edge
 * Function (Resend, from noreply@gofiley.com) with the API key kept
 * server-side — it never touches the client. On desktop we fall back to the
 * user's own SMTP only when the cloud path isn't reachable (truly offline or
 * not signed in) and they've configured it. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!msg.to.trim()) throw new Error("No recipient email address.");

  // Per-tier daily cap. Cloud sends are *also* capped server-side (send-email
  // edge fn); this local check additionally gates the desktop SMTP fallback.
  await checkEmailDailyCap();

  // Preferred path: cloud Resend via the edge function.
  if (supabase) {
    try {
      const { error } = (await invokeFn(supabase, "send-email", {
        body: {
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          attachments: msg.attachments,
        },
      })) as { error: { message: string } | null };
      if (!error) {
        await bumpEmailCount();
        return;
      }
      // Cloud reachable but refused (e.g. rate limit, not signed in). Surface
      // it on web; on desktop, try the SMTP fallback below.
      if (!hasDesktop)
        throw new Error(
          "Could not send email. Make sure the send-email function is deployed " +
            `and RESEND_API_KEY is set. (${error.message})`
        );
    } catch (e) {
      // Network error / offline. Web has no fallback; desktop falls through.
      if (!hasDesktop) throw e;
    }
  }

  // Desktop fallback: the user's own SMTP (works fully offline).
  if (hasDesktop) {
    const config = await loadEmailConfig();
    if (!emailConfigured(config))
      throw new Error(
        "Email isn't configured. Sign in for cloud sending, or add your own " +
          "SMTP details in Settings → Email for offline use."
      );
    await invoke("send_email", { config, message: msg });
    await bumpEmailCount();
    return;
  }

  throw new Error("Email is not available — cloud storage isn't configured.");
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
