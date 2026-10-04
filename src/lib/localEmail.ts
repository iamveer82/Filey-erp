import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { invoke } from "@tauri-apps/api/core";
import { getCacheScope } from "./api";
import { agentStorageScope, readAgentStorage, requireAgentStorageScope, writeAgentStorage } from "./agentStorage";
import { hasCredential, readCredential, saveCredential } from "./credentialStore";
import { isLocalMode } from "./dataMode";
import type { EmailMessage } from "./email";

const SETTINGS = "filey.email.personal";
const CREDENTIAL = "email:resend";
const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 60_000;
const UNCERTAIN = "Email delivery could not be confirmed. Check your Resend dashboard before trying again; Filey has not retried or used its hosted sender.";
export const PERSONAL_EMAIL_APP_REQUIRED = "Personal email sending requires the installed Filey desktop, Android or iOS app. Browser local mode can save your setup but cannot send through Resend.";

export interface LocalEmailConnection { senderEmail: string; senderName: string; keyStored: boolean }
export const personalEmailDesktop = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const personalEmailAvailable = (): boolean => personalEmailDesktop() || Capacitor.isNativePlatform();

function localScope(expected?: string): string {
  const scope = requireAgentStorageScope(expected);
  if (!isLocalMode()) throw new Error("Open local mode to use your personal email connection.");
  return scope;
}

function address(value: string, label: string): string {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email || email.length > 320 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email))
    throw new Error(`Enter one valid ${label} email address.`);
  return email;
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function sender(input: Pick<LocalEmailConnection, "senderEmail" | "senderName">) {
  const senderEmail = address(input.senderEmail, "verified sender");
  const senderName = typeof input.senderName === "string" ? input.senderName.trim() : "";
  if (senderName.length > 200 || /[<>]/.test(senderName) || hasControl(senderName)) throw new Error("Use a sender name without brackets or control characters (up to 200 characters).");
  return { senderEmail, senderName };
}

function apiKey(value: string): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^re_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error("Enter a valid Resend API key beginning with re_.");
  return key;
}

async function storedKey(scope: string, account: string): Promise<string | null> {
  try { return await readCredential(CREDENTIAL, account); }
  catch { localScope(scope); throw new Error("Could not read your personal email key from secure storage. Reconnect it in Settings → Email."); }
}

async function persistKey(scope: string, value: string | null): Promise<void> {
  try { await saveCredential(CREDENTIAL, value); }
  catch { localScope(scope); throw new Error("Could not save your personal email key in secure storage. Check the device vault and try again."); }
}

/** No credentials are read into a form or written into the metadata record. */
export function readLocalEmailConnection(): LocalEmailConnection {
  let stored: Partial<LocalEmailConnection> = {};
  try { stored = JSON.parse(readAgentStorage(SETTINGS) || "{}"); } catch { /* Invalid setup must be replaced explicitly. */ }
  return { senderEmail: typeof stored?.senderEmail === "string" ? stored.senderEmail : "",
    senderName: typeof stored?.senderName === "string" ? stored.senderName : "", keyStored: hasCredential(CREDENTIAL) };
}

/** Saving and checking setup never contact Resend or send an email. */
export async function saveLocalEmailConnection(input: Pick<LocalEmailConnection, "senderEmail" | "senderName">,
  replacementKey?: string, expectedScope?: string): Promise<void> {
  const scope = localScope(expectedScope), metadata = sender(input);
  const key = replacementKey?.trim() ? apiKey(replacementKey) : null;
  if (key) await persistKey(scope, key);
  else if (!await storedKey(scope, getCacheScope()!)) throw new Error("Add your own Resend API key before saving email setup.");
  localScope(scope);
  writeAgentStorage(SETTINGS, JSON.stringify(metadata), scope);
}

export async function clearLocalEmailConnection(expectedScope?: string): Promise<void> {
  const scope = localScope(expectedScope);
  await persistKey(scope, null);
  localScope(scope);
  writeAgentStorage(SETTINGS, null, scope);
}

export async function checkLocalEmailSetup(expectedScope?: string): Promise<void> {
  const scope = localScope(expectedScope);
  sender(readLocalEmailConnection());
  const key = await storedKey(scope, getCacheScope()!);
  localScope(scope);
  if (!key) throw new Error("Add your own Resend API key in Settings → Email before sending.");
  apiKey(key);
  if (!personalEmailAvailable()) throw new Error(PERSONAL_EMAIL_APP_REQUIRED);
}

function messageSnapshot(msg: EmailMessage): EmailMessage {
  const to = address(msg.to, "recipient");
  if (typeof msg.subject !== "string" || !msg.subject.trim() || msg.subject.length > 500 || hasControl(msg.subject))
    throw new Error("Enter an email subject without line breaks (up to 500 characters).");
  if (typeof msg.html !== "string" || !msg.html.trim() || msg.html.length > 500_000) throw new Error("Email content is empty or too large.");
  if (msg.attachments !== undefined && (!Array.isArray(msg.attachments) || msg.attachments.length > 5)) throw new Error("An email supports up to five attachments.");
  let encodedSize = 0;
  const attachments = msg.attachments?.map(attachment => {
    if (!attachment || typeof attachment.filename !== "string" || !attachment.filename.trim() || attachment.filename.length > 200
      || /[\\/]/.test(attachment.filename) || hasControl(attachment.filename)) throw new Error("Use an attachment filename without paths or control characters.");
    if (typeof attachment.content === "string" && attachment.content.length > 15_000_000) throw new Error("Email attachments are too large (15 MB encoded maximum).");
    // A repeated four-character group can exhaust the regex engine's stack on
    // ordinary PDFs. This linear scan accepts complete padded base64 quanta.
    if (typeof attachment.content !== "string" || !attachment.content || attachment.content.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content))
      throw new Error("Attachments must contain valid base64 file bytes.");
    encodedSize += attachment.content.length;
    if (encodedSize > 15_000_000) throw new Error("Email attachments are too large (15 MB encoded maximum).");
    return { filename: attachment.filename, content: attachment.content };
  });
  return { to, subject: msg.subject, html: msg.html, attachments,
    entityType: typeof msg.entityType === "string" ? msg.entityType : undefined,
    entityId: Number.isSafeInteger(msg.entityId) ? msg.entityId : undefined };
}

async function deadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(UNCERTAIN)), TIMEOUT_MS); })]); }
  finally { clearTimeout(timer); }
}

async function recordAttempt(scope: string, msg: EmailMessage, error?: string): Promise<void> {
  localScope(scope);
  // A fixed local client prevents a mode switch from sending this log to Filey.
  const { withLocalTransaction } = await import("./localdb");
  localScope(scope);
  const account = getCacheScope()!, separator = account.lastIndexOf(":user:");
  await withLocalTransaction(async client => {
    localScope(scope);
    const result = await client.from("email_messages").insert({ to_email: msg.to, subject: msg.subject,
      entity_type: msg.entityType ?? null, entity_id: msg.entityId ?? null, status: error ? "failed" : "sent",
      error: error ?? null, sent_at: new Date().toISOString(), user_id: account.slice(separator + 6), org_id: account.slice(0, separator) });
    if (result.error) throw result.error;
    localScope(scope);
  });
}

/** Personal delivery only. One POST, no hosted fallback or automatic retry.
 * API contract: https://resend.com/docs/api-reference/emails/send-email */
export async function sendPersonalEmail(input: EmailMessage): Promise<void> {
  const scope = localScope(), account = getCacheScope()!, msg = messageSnapshot(input);
  let failure: string | undefined;
  try {
    if (!personalEmailAvailable()) throw new Error(PERSONAL_EMAIL_APP_REQUIRED);
    const config = sender(readLocalEmailConnection());
    const key = await storedKey(scope, account);
    localScope(scope);
    if (!key) throw new Error("Add your own Resend API key in Settings → Email before sending.");
    const headers = { Authorization: `Bearer ${apiKey(key)}`, "Content-Type": "application/json", "Idempotency-Key": `filey-personal/${crypto.randomUUID()}` };
    const body = JSON.stringify({ from: config.senderName ? `${config.senderName} <${config.senderEmail}>` : config.senderEmail,
      to: [msg.to], subject: msg.subject, html: msg.html, attachments: msg.attachments });
    localScope(scope);
    let response: { status: number; body: string };
    try {
      response = personalEmailDesktop()
        ? await deadline(invoke<{ status: number; body: string }>("ai_proxy", { method: "POST", url: ENDPOINT, headers, body }))
        : await deadline(CapacitorHttp.request({ url: ENDPOINT, method: "POST", headers, data: body,
          responseType: "text", disableRedirects: true, connectTimeout: 30_000, readTimeout: TIMEOUT_MS })
          .then(result => ({ status: result.status, body: typeof result.data === "string" ? result.data : JSON.stringify(result.data) })));
    } catch { throw new Error(UNCERTAIN); }
    localScope(scope);
    // Never surface a provider/native body or echoed Authorization header.
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw new Error("Resend did not accept the email. Check your personal API key, verified sender and Resend account limits. Filey's hosted sender was not used.");
    let receipt: { id?: unknown; error?: unknown; name?: unknown };
    try { if (typeof response.body !== "string" || response.body.length > 65_536) throw new Error(); receipt = JSON.parse(response.body); }
    catch { throw new Error(UNCERTAIN); }
    if (!receipt || receipt.error || receipt.name || typeof receipt.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.id)) throw new Error(UNCERTAIN);
  } catch (error) {
    // All errors above are Filey's own bounded messages; raw native errors are discarded.
    failure = error instanceof Error ? error.message : "Could not send email with your personal connection.";
  }
  if (scope === agentStorageScope() && isLocalMode()) await recordAttempt(scope, msg, failure).catch(() => {});
  localScope(scope);
  if (failure) throw new Error(failure);
}
