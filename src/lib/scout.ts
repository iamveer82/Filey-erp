// Lead enrichment: fills in what a company publishes about itself on its own
// website, and scores leads from the trading history already in the books.
//
// Deliberately NOT a profile scraper. There is no social-profile harvesting,
// no email-pattern guessing, and no SMTP probing here — see docs/LEAD-DATA.md
// for why that line is drawn where it is.

import { readUrl, searchWeb, type ReachPage } from "./reach";

export interface CompanyDetails {
  /** The page the details came from — always shown to the user, so a wrong
   *  guess is visible rather than silently written into the CRM. */
  source: string;
  name?: string;
  emails: string[];
  phones: string[];
  /** UAE Tax Registration Number — 15 digits, as printed on tax invoices. */
  trn?: string;
  address?: string;
  summary?: string;
}

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
// A TRN is 15 digits and often printed with spaces/dashes for readability.
const TRN_RE = /\b(?:TRN|VAT(?:\s*(?:No|Number))?)\.?[:\s-]*((?:\d[\s-]?){15})\b/i;
const PHONE_RE = /\+?\d[\d\s()-]{7,17}\d/g;

/** Emails a site publishes for machines, not for people to write to. */
const NOISE_EMAIL =
  /(^|@)(example|sentry|wixpress|godaddy|squarespace|shopify|cloudflare|schema)\b|\.(png|jpe?g|gif|svg|webp|css|js)$/i;

const uniq = (xs: string[]) => [...new Set(xs)];

/** Pull the public business-contact details out of a page's text. Exported so
 *  the parsing can be tested without going near the network. */
export function extractCompanyDetails(page: ReachPage): CompanyDetails {
  const text = page.text;

  const emails = uniq(
    (text.match(EMAIL_RE) ?? [])
      .map((e) => e.toLowerCase())
      .filter((e) => !NOISE_EMAIL.test(e))
  ).slice(0, 5);

  const trnMatch = TRN_RE.exec(text);
  const trnDigits = trnMatch?.[1]?.replace(/\D/g, "");
  const trn = trnDigits?.length === 15 ? trnDigits : undefined;

  // A 15-digit TRN reads as a phone number to any digit-run pattern, so take it
  // out of the text before looking for phones rather than filtering after.
  const phoneText = trnMatch ? text.replace(trnMatch[0], " ") : text;
  // Matching digit runs is greedy by nature; require enough digits to be a real
  // number and drop anything that looks like a date range or a price.
  const phones = uniq(
    (phoneText.match(PHONE_RE) ?? [])
      .map((p) => p.trim())
      .filter((p) => {
        const digits = p.replace(/\D/g, "");
        return digits.length >= 9 && digits.length <= 15;
      })
  ).slice(0, 3);

  return {
    source: page.url,
    name: page.title && page.title !== page.url ? page.title : undefined,
    emails,
    phones,
    trn,
    address: firstAddressLine(text),
    summary: firstMeaningfulLine(text),
  };
}

/** A line that reads like a street address — the cheap heuristic is a UAE
 *  emirate or a PO Box, which is how local businesses print them. */
function firstAddressLine(text: string): string | undefined {
  const re =
    /^.{0,120}\b(P\.?O\.?\s*Box|Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah|Ras Al Khaimah|Umm Al Quwain)\b.{0,120}$/im;
  return re.exec(text)?.[0]?.trim();
}

function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t.length > 40 && !/^(Title|URL Source|Markdown Content):/i.test(t))
      return t.slice(0, 240);
  }
  return undefined;
}

/** Mailbox providers, not employers. An address at one of these says nothing
 *  about a company website, so there is nothing to enrich from. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
]);

/** The company domain implied by a work email — `sales@acme.ae` → `acme.ae`.
 *  Null for personal mailboxes and anything unparseable, so a customer who
 *  signed up with a Gmail address is simply not enrichable rather than sending
 *  us off to read gmail.com. */
export function companyDomainFromEmail(email?: string | null): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@");
  if (at.length !== 2) return null;
  const domain = at[1].replace(/[>,;\s].*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return FREE_MAIL.has(domain) ? null : domain;
}

/** Read a company's own website and return what it publishes about itself. */
export async function enrichFromWebsite(
  site: string,
  opts: { signal?: AbortSignal } = {}
): Promise<CompanyDetails> {
  const url = /^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`;
  return extractCompanyDetails(await readUrl(url, opts));
}

export interface LeadSignals {
  /** Invoices raised for this customer, all time. */
  invoices?: number;
  /** Total invoiced value, in the display currency. */
  revenue?: number;
  /** Currently overdue balance. */
  overdue?: number;
  /** Days since the last invoice, quote or logged activity. */
  daysSinceActivity?: number;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasTrn?: boolean;
}

export interface LeadScore {
  /** 0–100. Higher means worth your time today. */
  score: number;
  /** Plain reasons, shown next to the number so it is never a black box. */
  reasons: string[];
}

/** Score a lead from what the books already know. Deterministic and offline —
 *  no model, no network, so it means the same thing every time you sort by it. */
export function scoreLead(s: LeadSignals): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  const revenue = s.revenue ?? 0;
  if (revenue > 0) {
    // Log-ish banding: a first AED 1k matters far more than the 50th.
    const band =
      revenue >= 100_000 ? 40 : revenue >= 25_000 ? 30 : revenue >= 5_000 ? 20 : 10;
    score += band;
    reasons.push(`Invoiced ${Math.round(revenue).toLocaleString()} to date`);
  }

  if ((s.invoices ?? 0) >= 3) {
    score += 15;
    reasons.push(`${s.invoices} invoices — a repeat customer`);
  }

  const days = s.daysSinceActivity;
  if (days != null) {
    if (days <= 30) {
      score += 20;
      reasons.push("Active in the last month");
    } else if (days <= 90) {
      score += 10;
      reasons.push("Active in the last quarter");
    } else if (days > 365) {
      score -= 10;
      reasons.push("Nothing for over a year — likely cold");
    }
  }

  const contactable = [s.hasEmail, s.hasPhone].filter(Boolean).length;
  score += contactable * 5;
  if (!contactable) reasons.push("No email or phone on file — you cannot reach them");
  if (s.hasTrn) {
    score += 5;
    reasons.push("TRN on file — invoices can be raised as tax invoices");
  }

  // Owing money is a reason to call, not a reason to rank them lower.
  if ((s.overdue ?? 0) > 0) {
    score += 10;
    reasons.push(`${Math.round(s.overdue!).toLocaleString()} overdue — chase it`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/* ---------------- prospecting: find companies, then read their own sites ----
 *
 * The missing half of lead generation. Enrichment could already read a company
 * site once you knew the company; this finds candidates from a description of
 * who you want to sell to ("lubricant distributors in Sharjah") and then reads
 * each one's own site for the contact details it publishes.
 *
 * Search first, then the company's own domain — deliberately not social
 * profiles, guessed email patterns or SMTP probes. See docs/LEAD-DATA.md: that
 * line is about what Filey goes out and collects on the user's behalf, and one
 * of those techniques would put gofiley.com's sending reputation — the domain
 * that carries their invoices — at risk. */

export interface Prospect extends CompanyDetails {
  /** Where the search found them, kept so a wrong match is traceable. */
  site: string;
  title?: string;
  /** Why the search surfaced this one. */
  snippet?: string;
}

/** Directories and marketplaces: useful to a human reading results, useless as
 *  a "company" to enrich, since the contact details belong to the directory. */
const DIRECTORY_HOST =
  /(^|\.)(facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest|yellowpages|yelp|indiamart|alibaba|tradeindia|justdial|glassdoor|indeed|crunchbase|wikipedia|google|bing)\./i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * Find companies matching a description and pull the contact details each one
 * publishes on its own site.
 *
 * Sequential on purpose: this reads real websites through the shared reader,
 * and firing a dozen parallel fetches at it is how a rate limit turns into a
 * page of empty results.
 */
export async function findProspects(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {}
): Promise<{ prospects: Prospect[]; skipped: string[] }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const { hits } = await searchWeb(query, { limit: limit * 2, signal: opts.signal });

  const prospects: Prospect[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (prospects.length >= limit) break;
    const host = hostOf(hit.url);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    if (DIRECTORY_HOST.test(host)) {
      skipped.push(`${host} — directory or social platform, not a company site`);
      continue;
    }
    try {
      const details = await enrichFromWebsite(hit.url, { signal: opts.signal });
      // A result with no way to contact anyone is noise in a lead list.
      if (!details.emails.length && !details.phones.length) {
        skipped.push(`${host} — no contact details published`);
        continue;
      }
      prospects.push({
        ...details,
        site: hit.url,
        title: hit.title,
        snippet: hit.snippet,
      });
    } catch (e) {
      skipped.push(`${host} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { prospects, skipped };
}
