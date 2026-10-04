import { supabase, invokeFn } from "./supabase";
import { checkEmailDailyCap, bumpEmailCount } from "./license";
import { isLocalMode } from "./dataMode";
import { sendPersonalEmail } from "./localEmail";
import { agentStorageScope, AGENT_STORAGE_EVENT } from "./agentStorage";
import { getCacheScope } from "./api";

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
  /** What this email is about, so a customer's page can show its own
   *  correspondence. Same vocabulary as the link graph (see lib/links). */
  entityType?: string;
  entityId?: number;
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

/** The real reason a send failed.
 *
 *  A non-2xx from an Edge Function arrives as a FunctionsHttpError whose
 *  message is only "Edge Function returned a non-2xx status code" — the useful
 *  part is the JSON body, which `send-email` fills with something written for
 *  the user to read: "Daily email limit reached (10/day)", "attachments too
 *  large", "RESEND_API_KEY not configured", or Resend's own refusal.
 *
 *  This used to be discarded and replaced with a guess about the function not
 *  being deployed, which sent everyone looking in the wrong place — a customer
 *  who had simply hit their daily cap was told to go check a deployment. */
export async function edgeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
  try {
    const body = (await ctx?.json?.()) as { error?: string } | undefined;
    if (body?.error) return body.error;
  } catch {
    /* body already consumed or not JSON — fall back to the transport message */
  }
  const msg = error instanceof Error ? error.message : String(error);
  return `Could not send email. ${msg}`;
}

/** Local mode uses the user's personal Resend connection. Cloud mode keeps the
 * hosted sender and its server-enforced quota. Neither path falls back to the other. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!msg.to.trim()) throw new Error("No recipient email address.");
  if (isLocalMode()) return sendPersonalEmail(msg);
  const reviewed = structuredClone(msg);
  const context = await hostedEmailContext();
  try {
    // Keep the hosted tier guard; local personal sends never reach it.
    await checkEmailDailyCap();
    await context.verify();
    const { data, error } = await hostedEmailRequest(context, {
      requestId: crypto.randomUUID(), to: reviewed.to, subject: reviewed.subject,
      html: reviewed.html, attachments: reviewed.attachments,
    }, 2);
    const failure = error ? await edgeErrorMessage(error) : (data as { error?: string } | null)?.error ?? null;
    await context.verify();
    // The fixed cloud client/JWT and explicit author/org prevent a delayed log
    // from switching to local storage or the next signed-in account.
    await logHostedEmail(context, {
      to_email: reviewed.to, subject: reviewed.subject, entity_type: reviewed.entityType,
      entity_id: reviewed.entityId, status: failure ? "failed" : "sent", error: failure ?? undefined,
    }).catch(() => {});
    await context.verify();
    if (failure) throw new Error(failure);
    await bumpEmailCount(context.assertCurrent).catch(() => {});
    await context.verify();
  } finally { context.dispose(); }
}

interface HostedEmailContext {
  client: NonNullable<typeof supabase>; user: string; org: string; token: string;
  signal: AbortSignal; assertCurrent: () => void; verify: () => Promise<void>; dispose: () => void;
}

/** Capture account, organization and mode before the first asynchronous step. */
async function hostedEmailContext(): Promise<HostedEmailContext> {
  if (!supabase) throw new Error("Email is not available — sign in to send.");
  const client = supabase, scope = agentStorageScope(), account = getCacheScope();
  if (!scope || !account || isLocalMode()) throw new Error("Sign in to your cloud workspace before sending email.");
  const split = account.lastIndexOf(":user:"), user = account.slice(split + 6), org = account.slice(0, split);
  const controller = new AbortController();
  const assertCurrent = () => {
    if (isLocalMode() || scope !== agentStorageScope() || controller.signal.aborted)
      throw new Error("Your workspace changed. Review the email again before sending.");
  };
  const initial = await client.auth.getSession();
  assertCurrent();
  const session = initial.data.session;
  if (initial.error || !session?.access_token?.trim() || session.user.id !== user)
    throw new Error("Your account changed. Sign in again before sending email.");
  const stale = () => { try { assertCurrent(); } catch { controller.abort(); } };
  const events = [AGENT_STORAGE_EVENT, "filey:workspace-changed", "filey:workspace-transition", "storage"];
  events.forEach(event => window.addEventListener(event, stale));
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
    if (next?.user.id !== user) controller.abort();
  });
  const verify = async () => {
    assertCurrent();
    const current = await client.auth.getSession();
    assertCurrent();
    if (current.error || current.data.session?.user.id !== user) {
      controller.abort();
      throw new Error("Your account changed. Review the email again before sending.");
    }
  };
  return { client, user, org, token: session.access_token, signal: controller.signal, assertCurrent, verify,
    dispose: () => { events.forEach(event => window.removeEventListener(event, stale)); subscription.unsubscribe(); } };
}

function transientEmailError(error: unknown): boolean {
  if (!error) return false;
  const detail = error as { context?: { status?: number }; message?: string };
  return detail.context?.status === undefined ? /fetch|network|timeout/i.test(detail.message ?? "") : [404, 408, 500, 502, 503, 504].includes(detail.context.status);
}

async function hostedEmailRequest(context: HostedEmailContext, body: Record<string, unknown>, retries: number) {
  for (let attempt = 0; ; attempt++) {
    await context.verify();
    const result = await invokeFn(context.client, "send-email", { body: { ...body, expected_org_id: context.org },
      headers: { Authorization: `Bearer ${context.token}` }, signal: context.signal }, 0);
    await context.verify();
    if (!result.error || attempt >= retries || !transientEmailError(result.error)) return result;
    await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    // Recheck identity before retry; never refresh this action into another JWT.
  }
}

export async function checkHostedEmailConnection(): Promise<{ configured?: boolean; from?: string | null; error?: string }> {
  const context = await hostedEmailContext();
  try {
    const result = await hostedEmailRequest(context, { action: "status" }, 0);
    if (result.error) throw new Error(await edgeErrorMessage(result.error));
    await context.verify();
    return result.data as { configured?: boolean; from?: string | null; error?: string };
  } finally { context.dispose(); }
}

async function logHostedEmail(context: HostedEmailContext, row: {
  to_email: string;
  subject: string;
  entity_type?: string;
  entity_id?: number;
  status: "sent" | "failed";
  error?: string;
}): Promise<void> {
  await context.verify();
  const result = await context.client.from("email_messages").insert({ ...row, user_id: context.user,
    org_id: context.org === "default" ? null : context.org }).setHeader("Authorization", `Bearer ${context.token}`).abortSignal(context.signal);
  if (result.error) throw result.error;
  await context.verify();
  window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables: ["email_messages"] } }));
}

/** Send a document-summary email through Resend for the list-row "Email"
 *  share, so it actually sends instead of opening the OS mail client. `text`
 *  is the same summary used for the WhatsApp/SMS shares; URLs in it are made
 *  clickable. */
export async function sendShareEmail(
  to: string,
  subject: string,
  text: string
): Promise<void> {
  if (!to.trim()) throw new Error("This contact has no email address on file.");
  const html = esc(text)
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  await sendEmail({ to, subject, html: emailShell(subject, html) });
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
