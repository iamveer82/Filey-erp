import { beforeEach, describe, expect, it } from "vitest";
import {
  listDealContacts,
  pruneDealContacts,
  removeDealContact,
  setDealContact,
} from "../dealContacts";

// Roles are the deal-level answer to "who actually decides?" — one row per
// (deal, person), re-roles in place, and pruning must never leave rows pointing
// at deals that no longer exist.
beforeEach(() => {
  localStorage.clear();
});

describe("dealContacts", () => {
  it("attaches a contact with a role and lists it for its deal only", async () => {
    const row = await setDealContact(7, 42, "Decision maker");
    expect(row.id).toBeGreaterThan(0);

    expect(await listDealContacts(7)).toHaveLength(1);
    expect(await listDealContacts(8)).toHaveLength(0);
  });

  it("re-roles in place instead of duplicating", async () => {
    await setDealContact(1, 5, "Champion");
    await setDealContact(1, 5, "Decision maker");
    const rows = await listDealContacts(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("Decision maker");
  });

  it("refuses an empty role — a link with no role is noise", async () => {
    await expect(setDealContact(1, 5, "   ")).rejects.toThrow(/role/i);
  });

  it("removes by (deal, person)", async () => {
    await setDealContact(2, 9, "Finance");
    await removeDealContact(2, 9);
    expect(await listDealContacts(2)).toHaveLength(0);
  });

  it("prunes roles of deleted deals and keeps the rest", async () => {
    await setDealContact(10, 1, "Gatekeeper");
    await setDealContact(11, 2, "Champion");
    const removed = await pruneDealContacts([11]);
    expect(removed).toBe(1);
    expect(await listDealContacts(10)).toHaveLength(0);
    expect(await listDealContacts(11)).toHaveLength(1);
  });
});
