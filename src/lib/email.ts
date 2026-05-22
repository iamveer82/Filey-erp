import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";

export interface EmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
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
  } catch {
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

/** Send one HTML email. Desktop uses the local SMTP bridge; web uses the
 *  Supabase `send-email` Edge Function (Resend) so no SMTP credentials
 *  ever live on the client. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!msg.to.trim()) throw new Error("No recipient email address.");

  if (hasDesktop) {
    const config = await loadEmailConfig();
    if (!emailConfigured(config))
      throw new Error(
        "Email isn't configured. Add your Gmail SMTP details in Settings → Email."
      );
    await invoke("send_email", { config, message: msg });
    return;
  }

  if (!supabase)
    throw new Error("Email is not available — cloud storage isn't configured.");
  const { error } = await supabase.functions.invoke("send-email", {
    body: { to: msg.to, subject: msg.subject, html: msg.html },
  });
  if (error)
    throw new Error(
      "Could not send email. Make sure the send-email function is deployed " +
        `and RESEND_API_KEY is set. (${error.message})`
    );
}

/** Escape a user-supplied value before embedding it in email HTML.
 *  Prevents HTML/script injection from customer names, notes, etc. */
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
      <p style="color:#A0A0A0;font-size:12px;margin-top:24px">
        Sent via Filey ERP
      </p>
    </div>
  </div>`;
}
