// Bulk email: turning a lead list into a campaign, and sending it without
// wrecking the domain that carries the invoices.
//
// Marketing mail and transactional mail share one sending domain here
// (gofiley.com, via Resend). A spam complaint on a campaign therefore lands on
// the same reputation that delivers invoices and payment receipts. Everything
// in this file exists to keep that from happening:
//
//   * only people already in the customer book — no imported or scraped lists
//   * the opt-out list is consulted on every send and cannot be bypassed
//   * every message carries a working unsubscribe line
//   * one address is mailed once per campaign, however many records match
//   * sends are paced, and stop cleanly when the daily cap is reached
//
// The send loop is resumable: progress is recorded per recipient, so a campaign
// stopped by the cap or a closed laptop picks up where it left off instead of
// mailing the first half of the list twice.

import { crm, type Campaign, type CampaignRecipient, type CrmCustomer } from "./api";
import { sendEmail, emailShell, esc } from "./email";
import type { Lead } from "./marketing";

/** Gap between messages. Slow enough not to look like a blast to the receiving
 *  side, fast enough that a few hundred recipients finish while you watch. */
const SEND_DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const normalizeEmail = (e?: string | null) => (e ?? "").trim().toLowerCase();

/** Merge fields a campaign body may use. Values are HTML-escaped at render
 *  time, so a customer called `<script>` is text, not markup. */
export function renderTemplate(
  template: string,
  customer: Pick<CrmCustomer, "name" | "company" | "email">
): string {
  const first = (customer.name ?? "").trim().split(/\s+/)[0] ?? "";
  const values: Record<string, string> = {
    name: customer.name ?? "",
    first_name: first,
    company: customer.company ?? customer.name ?? "",
    email: customer.email ?? "",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in values ? esc(values[key]) : whole
  );
}

/** The placeholders a body actually uses, for the editor's preview. */
export function usedMergeFields(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}

/**
 * Every campaign message ends with this. It is appended by the sender rather
 * than left to the template, so a campaign cannot go out without it.
 *
 * ponytail: unsubscribe is a mailto, not a one-click HTTP link. It works today
 * with no new infrastructure — the reply arrives and the address goes on the
 * opt-out list. A one-click List-Unsubscribe header needs a public endpoint;
 * add one when volume justifies it (bulk senders increasingly require it).
 */
export function unsubscribeFooter(fromName: string, replyTo: string): string {
  const to = esc(replyTo);
  return [
    '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">',
    '<p style="font-size:12px;color:#737373;line-height:1.5">',
    `You are receiving this because you are a customer of ${esc(fromName)}.`,
    ` To stop receiving these, <a href="mailto:${to}?subject=Unsubscribe">reply with "unsubscribe"</a>`,
    " and you will be removed.",
    "</p>",
  ].join("");
}

export interface AudienceOptions {
  /** Only leads scoring at least this. */
  minScore?: number;
  /** Skip anyone with nothing on file to send to. */
  requireEmail?: boolean;
}

/**
 * Turn ranked leads into a recipient list. Opted-out addresses are marked
 * `skipped` rather than dropped, so the campaign records honestly that they
 * were excluded and why.
 */
export function buildRecipients(
  leads: Lead[],
  optedOut: Set<string>,
  opts: AudienceOptions = {}
): CampaignRecipient[] {
  const seen = new Set<string>();
  const out: CampaignRecipient[] = [];

  for (const lead of leads) {
    if (opts.minScore != null && lead.score < opts.minScore) continue;
    const email = normalizeEmail(lead.customer.email);
    const base = { customer_id: lead.customer.id, name: lead.customer.name, email };

    if (!email) {
      if (!opts.requireEmail)
        out.push({ ...base, status: "skipped", error: "No email address on file" });
      continue;
    }
    if (optedOut.has(email)) {
      out.push({ ...base, status: "skipped", error: "Unsubscribed" });
      continue;
    }
    // One message per address, even when two customer records share it.
    if (seen.has(email)) {
      out.push({ ...base, status: "skipped", error: "Duplicate address in this list" });
      continue;
    }
    seen.add(email);
    out.push({ ...base, status: "pending" });
  }
  return out;
}

export interface SendProgress {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  /** Set when the run stopped early — daily cap, or the caller cancelled. */
  stoppedBecause?: string;
}

export interface SendOptions {
  campaign: Campaign;
  customers: CrmCustomer[];
  /** Business name and reply address for the unsubscribe line. */
  fromName: string;
  replyTo: string;
  onProgress?: (p: SendProgress, recipients: CampaignRecipient[]) => void;
  /** Checked between messages so the user can stop a run mid-flight. */
  shouldStop?: () => boolean;
  /** Injectable for tests; defaults to the real delay. */
  delayMs?: number;
}

/**
 * Send everything still `pending` on a campaign. Returns the updated recipient
 * list and a summary — the caller persists both, so a crash mid-run loses at
 * most the messages since the last progress callback rather than the record of
 * what was already delivered.
 */
export async function sendCampaign(opts: SendOptions): Promise<{
  recipients: CampaignRecipient[];
  progress: SendProgress;
}> {
  const { campaign, customers, fromName, replyTo } = opts;
  const delay = opts.delayMs ?? SEND_DELAY_MS;
  const byId = new Map(customers.map((c) => [c.id, c]));
  const recipients = campaign.recipients.map((r) => ({ ...r }));

  // Re-read the opt-out list at send time, not at build time: someone may have
  // unsubscribed between drafting the campaign and pressing send.
  const optedOut = new Set(
    (await crm.optOuts()).map((o) => normalizeEmail(o.email)).filter(Boolean)
  );

  const footer = unsubscribeFooter(fromName, replyTo);
  const tally = (): SendProgress => ({
    sent: recipients.filter((r) => r.status === "sent").length,
    failed: recipients.filter((r) => r.status === "failed").length,
    skipped: recipients.filter((r) => r.status === "skipped").length,
    remaining: recipients.filter((r) => r.status === "pending").length,
  });

  let stoppedBecause: string | undefined;

  for (const r of recipients) {
    if (r.status !== "pending") continue;
    if (opts.shouldStop?.()) {
      stoppedBecause = "Stopped";
      break;
    }

    const email = normalizeEmail(r.email);
    if (optedOut.has(email)) {
      r.status = "skipped";
      r.error = "Unsubscribed";
      continue;
    }

    const customer =
      byId.get(r.customer_id) ??
      ({
        name: r.name,
        email: r.email,
      } as CrmCustomer);

    try {
      const body = renderTemplate(campaign.body_html, customer);
      await sendEmail({
        to: r.email,
        subject: renderTemplate(campaign.subject, customer),
        html: emailShell(campaign.subject, body + footer),
      });
      r.status = "sent";
      r.sent_at = new Date().toISOString();
      r.error = undefined;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Some failures are about the environment, not this recipient: the daily
      // cap, or being signed out entirely. Stop and leave everyone still pending
      // rather than branding the whole list undeliverable — a false "failed" is
      // worse than a pause, because nobody retries a failure.
      if (/daily|cap|limit|sign in|not available/i.test(message)) {
        stoppedBecause = message;
        break;
      }
      r.status = "failed";
      r.error = message;
    }

    opts.onProgress?.(tally(), recipients);
    if (delay > 0) await sleep(delay);
  }

  const progress = { ...tally(), stoppedBecause };
  opts.onProgress?.(progress, recipients);
  return { recipients, progress };
}
