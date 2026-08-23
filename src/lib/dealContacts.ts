// Deal-contact roles — who at the customer actually plays which part on a
// specific deal (decision maker, champion, finance, gatekeeper). Ported from
// trycompai's DealContact join table.
//
// Storage is deliberately device-local: crm_people already syncs, but a
// per-deal role map needs either new columns on crm_opportunities or a new
// table, and the cloud schema is frozen for this release. Rows live in their
// own localdb collection ("crm_deal_contacts") that is NOT in PUSH_TABLES, so
// nothing ever pushes a table the cloud doesn't have — the cost is roles don't
// follow the user across devices yet. Promote to a real synced table when a
// migration lands; every reader here defaults missing fields, so old rows keep
// working unchanged.

import { loadColl, replaceColl } from "./localdb";

const COLL = "crm_deal_contacts";

/** The roles a small UAE sales team actually uses. Free text is accepted —
 *  these only seed the picker. */
export const DEAL_ROLES = [
  "Decision maker",
  "Champion",
  "Technical",
  "Finance",
  "Gatekeeper",
] as const;

export interface DealContact {
  id: number;
  deal_id: number;
  person_id: number;
  role: string;
  created_at: string;
}

type Row = Record<string, unknown>;

function normalize(r: Row): DealContact | null {
  if (r.deal_id == null || r.person_id == null) return null;
  return {
    id: Number(r.id ?? 0),
    deal_id: Number(r.deal_id),
    person_id: Number(r.person_id),
    role: typeof r.role === "string" ? r.role : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

async function persist(rows: DealContact[]): Promise<void> {
  // replaceColl writes whole-array and skips the push journal — exactly right
  // for a collection the cloud doesn't know about.
  await replaceColl(COLL, rows as unknown as Row[]);
}

/** Roles for one deal, or all of them when no id is given. */
export async function listDealContacts(dealId?: number): Promise<DealContact[]> {
  const rows = await loadColl(COLL);
  const out = rows
    .map(normalize)
    .filter((r): r is DealContact => r !== null)
    .filter((r) => dealId == null || r.deal_id === dealId);
  out.sort(
    (a, b) =>
      Number(a.deal_id) - Number(b.deal_id) || Number(a.id) - Number(b.id)
  );
  return out;
}

/** Attach (or re-role) a contact on a deal. One row per (deal, person). */
export async function setDealContact(
  dealId: number,
  personId: number,
  role: string
): Promise<DealContact> {
  if (!Number.isFinite(dealId) || !Number.isFinite(personId))
    throw new Error("A deal and a contact are required.");
  const cleanRole = role.trim();
  if (!cleanRole) throw new Error("Pick a role for this contact.");

  const all = (await loadColl(COLL))
    .map(normalize)
    .filter((r): r is DealContact => r !== null);
  const existing = all.find(
    (r) => r.deal_id === dealId && r.person_id === personId
  );
  let row: DealContact;
  if (existing) {
    row = { ...existing, role: cleanRole };
    Object.assign(existing, row);
  } else {
    row = {
      id: all.reduce((m, r) => Math.max(m, r.id), 0) + 1,
      deal_id: dealId,
      person_id: personId,
      role: cleanRole,
      created_at: new Date().toISOString(),
    };
    all.push(row);
  }
  await persist(all);
  return row;
}

/** Detach a contact from a deal. */
export async function removeDealContact(
  dealId: number,
  personId: number
): Promise<void> {
  const all = (await loadColl(COLL))
    .map(normalize)
    .filter((r): r is DealContact => r !== null);
  await persist(all.filter((r) => !(r.deal_id === dealId && r.person_id === personId)));
}

/** Drop every role row pointing at deals that no longer exist. Cheap hygiene:
 *  called after deal deletes so stale links can't resurface a ghost. */
export async function pruneDealContacts(aliveIds: number[]): Promise<number> {
  const alive = new Set(aliveIds.map(Number));
  const all = (await loadColl(COLL))
    .map(normalize)
    .filter((r): r is DealContact => r !== null);
  const kept = all.filter((r) => alive.has(r.deal_id));
  if (kept.length !== all.length) await persist(kept);
  return all.length - kept.length;
}
