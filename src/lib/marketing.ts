// Marketing: turns the customer list and the invoice ledger into a ranked list
// of who is worth contacting, using the deterministic scorer in lib/scout.
//
// Pure functions over plain rows — no network, no model — so the ranking means
// the same thing every time and is testable without mocking the data layer.

import { companyDomainFromEmail, scoreLead, type LeadScore } from "./scout";
import type { CrmCustomer, InvoiceDocSummary } from "./api";

export interface Lead {
  customer: CrmCustomer;
  score: number;
  reasons: string[];
  /** Total invoiced, all time. */
  revenue: number;
  invoices: number;
  overdue: number;
  /** Days since their most recent invoice; null when they've never been billed. */
  daysSinceActivity: number | null;
  /** Company domain implied by their work email, when there is one. */
  domain: string | null;
  /** Missing something you'd need to actually run a campaign at them. */
  incomplete: boolean;
}

const daysBetween = (fromIso: string, toIso: string) =>
  Math.floor(
    (new Date(`${toIso}T00:00:00`).getTime() -
      new Date(`${fromIso}T00:00:00`).getTime()) /
      86_400_000
  );

/**
 * Build the ranked lead list. `today` is passed in rather than read from the
 * clock so the ordering is reproducible in tests and in a report.
 */
export function buildLeads(
  customers: CrmCustomer[],
  invoices: InvoiceDocSummary[],
  today: string
): Lead[] {
  // One pass over invoices — a per-customer filter would be O(customers × docs),
  // which is the kind of thing that only hurts once the ledger is real.
  const byCustomer = new Map<
    string,
    { count: number; revenue: number; overdue: number; latest: string }
  >();
  for (const inv of invoices) {
    if (inv.status === "draft") continue;
    const key = (inv.customer_name || "").trim().toLowerCase();
    if (!key) continue;
    const agg = byCustomer.get(key) ?? { count: 0, revenue: 0, overdue: 0, latest: "" };
    agg.count += 1;
    agg.revenue += Number(inv.total) || 0;
    const balance = Number(inv.balance) || 0;
    const due = inv.due_date ?? "";
    if (balance > 0 && due && due < today && inv.status !== "paid")
      agg.overdue += balance;
    const issued = inv.issue_date ?? "";
    if (issued > agg.latest) agg.latest = issued;
    byCustomer.set(key, agg);
  }

  const leads = customers.map((customer): Lead => {
    const agg = byCustomer.get((customer.name || "").trim().toLowerCase());
    const daysSinceActivity = agg?.latest
      ? Math.max(0, daysBetween(agg.latest, today))
      : null;
    const hasEmail = !!customer.email?.trim();
    const hasPhone = !!(customer.phone?.trim() || customer.phone_e164?.trim());

    const scored: LeadScore = scoreLead({
      invoices: agg?.count ?? 0,
      revenue: agg?.revenue ?? 0,
      overdue: agg?.overdue ?? 0,
      daysSinceActivity: daysSinceActivity ?? undefined,
      hasEmail,
      hasPhone,
      hasTrn: !!customer.trn?.trim(),
    });

    return {
      customer,
      score: scored.score,
      reasons: scored.reasons,
      revenue: agg?.revenue ?? 0,
      invoices: agg?.count ?? 0,
      overdue: agg?.overdue ?? 0,
      daysSinceActivity,
      domain: companyDomainFromEmail(customer.email),
      incomplete: !hasEmail || !hasPhone,
    };
  });

  // Best first; ties broken by revenue then name so the order is stable rather
  // than whatever the source list happened to be in.
  return leads.sort(
    (a, b) =>
      b.score - a.score ||
      b.revenue - a.revenue ||
      a.customer.name.localeCompare(b.customer.name)
  );
}

export interface LeadStats {
  total: number;
  /** Worth a call this week. */
  hot: number;
  /** Missing an email or a phone — you cannot run a campaign at them. */
  incomplete: number;
  /** Have a company domain we could read details from. */
  enrichable: number;
}

/** A lead is "hot" at 60+: enough signal that it beats working down the list
 *  alphabetically, without flagging most of the book. */
export const HOT_SCORE = 60;

/** Rows for a "leads.csv" export — Scout's own output shape, so a list can go
 *  to a spreadsheet or another tool without retyping it. */
export function leadsToCsvRows(leads: Lead[]): Record<string, string>[] {
  return leads.map((l) => ({
    Name: l.customer.name,
    Company: l.customer.company ?? "",
    Email: l.customer.email ?? "",
    Phone: l.customer.phone ?? "",
    TRN: l.customer.trn ?? "",
    Domain: l.domain ?? "",
    Score: String(l.score),
    Reasons: l.reasons.join("; "),
    Invoiced: String(l.revenue),
    Invoices: String(l.invoices),
    Overdue: String(l.overdue),
    "Days since last invoice":
      l.daysSinceActivity == null ? "" : String(l.daysSinceActivity),
  }));
}

export interface DuplicateGroup {
  /** Why these were grouped: the exact value they share. */
  reason: string;
  key: string;
  leads: Lead[];
}

/** Normalised for comparison: case, punctuation and the company suffixes that
 *  the same business gets written with and without. */
function nameKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(
      /\b(llc|l\.l\.c|fzc|fze|fz-llc|ltd|limited|co|company|est|establishment|trading|general|the)\b/g,
      ""
    )
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Find customer records that look like the same business — the same address
 * invoiced twice, or "Acme LLC" and "Acme L.L.C." living as separate rows.
 * Reports rather than merges: which of two records is the real one is a
 * judgement call, and a wrong automatic merge loses invoice history.
 */
export function findDuplicates(leads: Lead[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const group = (reason: string, keyOf: (l: Lead) => string) => {
    const by = new Map<string, Lead[]>();
    for (const l of leads) {
      const k = keyOf(l);
      if (!k) continue;
      by.set(k, [...(by.get(k) ?? []), l]);
    }
    for (const [key, list] of by)
      if (list.length > 1) groups.push({ reason, key, leads: list });
  };

  group("Same email address", (l) => (l.customer.email ?? "").trim().toLowerCase());
  group("Same TRN", (l) => (l.customer.trn ?? "").replace(/\D/g, ""));
  group("Similar company name", (l) => nameKey(l.customer.name ?? ""));

  // A pair caught by both email and name should be reported once, by the
  // stronger signal — email and TRN are identifiers, a name is a guess.
  const claimed = new Set<number>();
  const deduped: DuplicateGroup[] = [];
  for (const g of groups) {
    const ids = g.leads.map((l) => l.customer.id);
    if (ids.every((id) => claimed.has(id))) continue;
    ids.forEach((id) => claimed.add(id));
    deduped.push(g);
  }
  return deduped;
}

export function leadStats(leads: Lead[]): LeadStats {
  return {
    total: leads.length,
    hot: leads.filter((l) => l.score >= HOT_SCORE).length,
    incomplete: leads.filter((l) => l.incomplete).length,
    enrichable: leads.filter((l) => l.domain && l.incomplete).length,
  };
}
