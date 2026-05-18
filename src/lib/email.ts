import { invoke } from "@tauri-apps/api/core";

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
  try {
    if (hasDesktop) {
      const v = await invoke<string | null>("cache_get", { key: KEY });
      return v ? (JSON.parse(v) as EmailConfig) : null;
    }
    const v = localStorage.getItem("cache:" + KEY);
    return v ? (JSON.parse(v) as EmailConfig) : null;
  } catch {
    return null;
  }
}

export async function saveEmailConfig(c: EmailConfig): Promise<void> {
  const json = JSON.stringify(c);
  if (hasDesktop) await invoke("cache_set", { key: KEY, value: json });
  else localStorage.setItem("cache:" + KEY, json);
}

/** Send one HTML email via the desktop SMTP bridge. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!hasDesktop)
    throw new Error(
      "Email sending is available in the Filey desktop app only."
    );
  const config = await loadEmailConfig();
  if (!emailConfigured(config))
    throw new Error(
      "Email isn't configured. Add your Gmail SMTP details in Settings → Email."
    );
  if (!msg.to.trim()) throw new Error("No recipient email address.");
  await invoke("send_email", { config, message: msg });
}

/** Minimal branded HTML wrapper for transactional emails. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Poppins,Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
    <div style="background:#FFD600;padding:18px 24px;border-radius:12px 12px 0 0">
      <strong style="font-size:18px">${title}</strong>
    </div>
    <div style="border:1px solid #E4DAC6;border-top:0;border-radius:0 0 12px 12px;padding:24px;background:#fff">
      ${bodyHtml}
      <p style="color:#A89F8C;font-size:12px;margin-top:24px">
        Sent via Filey ERP
      </p>
    </div>
  </div>`;
}
