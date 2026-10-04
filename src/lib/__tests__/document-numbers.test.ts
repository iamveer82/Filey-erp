import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ local: true, account: "org:user:00000000-0000-4000-8000-000000000001", org: "org",
  rpc: vi.fn(), session: vi.fn() }));
vi.mock("../api", () => ({ getCacheScope: () => state.account, getCacheOrg: () => state.org, tools: {} }));
vi.mock("../agentStorage", () => ({ requireAgentStorageScope: (expected?: string) => {
  const current = `${state.local ? "local" : "cloud"}:${state.account}`;
  if (!state.account || (expected && expected !== current)) throw new Error("Your account changed.");
  return current;
} }));
vi.mock("../dataMode", () => ({ isLocalMode: () => state.local }));
vi.mock("../supabase", () => ({ sb: () => ({ auth: { getSession: state.session }, rpc: state.rpc }) }));
import { allocateDocumentNumber } from "../documentNumbers";
import { clearLocalCache, localClient, loadColl } from "../localdb";
import { validateNumberedCollection } from "../documentNumberRules";

const request = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  localStorage.clear(); clearLocalCache(); vi.clearAllMocks();
  state.local = true; state.org = "org"; state.account = "org:user:00000000-0000-4000-8000-000000000001";
  state.session.mockResolvedValue({ data: { session: { user: { id: state.account.split(":user:")[1] }, access_token: "fixture-token" } }, error: null });
  state.rpc.mockImplementation(() => ({ setHeader: vi.fn().mockResolvedValue({ data: "CLOUD-0001", error: null }) }));
});

describe("document number reservations", () => {
  it("allocates twelve concurrent requests uniquely and does not reuse abandoned numbers", async () => {
    const values = await Promise.all(Array.from({ length: 12 }, () => allocateDocumentNumber("invoice", [], { invoice: "INV-{0001}" })));
    expect(values).toEqual(Array.from({ length: 12 }, (_, n) => `INV-${String(n + 1).padStart(4, "0")}`));
    expect((await loadColl("document_number_reservations"))).toHaveLength(12);
    expect(await allocateDocumentNumber("invoice", [], { invoice: "INV-{0001}" })).toBe("INV-0013");
  });
  it("replays the same request and rejects changed request parameters", async () => {
    expect(await allocateDocumentNumber("quote", [], { quote: "QT-{050}" }, request)).toBe("QT-050");
    expect(await allocateDocumentNumber("quote", ["QT-099"], { quote: "QT-{050}" }, request)).toBe("QT-050");
    await expect(allocateDocumentNumber("quote", [], { quote: "QT-{001}" }, request)).rejects.toThrow("request changed");
    expect(await loadColl("document_number_reservations")).toHaveLength(1);
  });
  it("seeds the actual stored records, shares sales/purchase invoice namespace, and preserves custom formats", async () => {
    await localClient.from("invoice_docs").insert({ number: "doc-025-26", org_id: "org" });
    expect(await allocateDocumentNumber("purchase_invoice", [], { purchase_invoice: "DOC-{001}-26" })).toBe("DOC-026-26");
    expect(await allocateDocumentNumber("invoice", [], { invoice: "DOC-{001}-26" })).toBe("DOC-027-26");
  });
  it("coordinates another account's reservations in the same workspace without replaying their request", async () => {
    await allocateDocumentNumber("invoice", [], { invoice: "INV-{001}" }, request);
    state.account = "org:user:00000000-0000-4000-8000-000000000002";
    expect(await allocateDocumentNumber("invoice", [], { invoice: "INV-{001}" })).toBe("INV-002");
    await expect(allocateDocumentNumber("invoice", [], { invoice: "INV-{001}" }, request)).rejects.toThrow("request changed");
  });
  it("reads embedded letter numbers and keeps namespaces/workspaces independent", async () => {
    await localClient.from("app_settings").insert({ key: "letters", org_id: "org", value: JSON.stringify([{ id: "a", form: { number: "LTR-008" } }]) });
    expect(await allocateDocumentNumber("letter", [], { letter: "LTR-{001}" })).toBe("LTR-009");
    expect(await allocateDocumentNumber("packaging_list", [], { packaging_list: "LTR-{001}" })).toBe("LTR-001");
    state.org = "other"; state.account = "other:user:00000000-0000-4000-8000-000000000001";
    expect(await allocateDocumentNumber("letter", [], { letter: "LTR-{001}" })).toBe("LTR-001");
  });
  it("pins cloud request identity and stops a response after workspace switch", async () => {
    state.local = false;
    expect(await allocateDocumentNumber("invoice", [], { invoice: "INV-{0001}" }, request)).toBe("CLOUD-0001");
    expect(state.rpc).toHaveBeenCalledWith("filey_reserve_document_number", expect.objectContaining({ p_request: request, p_org: "org", p_actor: state.account.split(":user:")[1] }));
    state.rpc.mockImplementation(() => ({ setHeader: async () => { state.account = "other:user:x"; return { data: "STALE", error: null }; } }));
    await expect(allocateDocumentNumber("invoice")).rejects.toThrow("account changed");
  });
  it("refuses account-mismatched sessions and surfaces cloud errors without a client fallback", async () => {
    state.local = false;
    state.session.mockResolvedValueOnce({ data: { session: { user: { id: "other-user" } } }, error: null });
    await expect(allocateDocumentNumber("invoice")).rejects.toThrow("account changed");
    expect(state.rpc).not.toHaveBeenCalled();
    state.rpc.mockImplementation(() => ({ setHeader: async () => ({ data: null, error: new Error("Permission denied") }) }));
    await expect(allocateDocumentNumber("invoice")).rejects.toThrow("Permission denied");
  });
  it("rejects malformed/unbounded patterns without writing reservations", async () => {
    await expect(allocateDocumentNumber("invoice", [], { invoice: "X-{001}-{001}" })).rejects.toThrow("one counter");
    await expect(allocateDocumentNumber("invoice", [], { invoice: "X-{0000000000001}" })).rejects.toThrow("one counter");
    expect(await loadColl("document_number_reservations")).toEqual([]);
  });
  it("never rounds or restarts exhausted 16 digit counters", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-9007199254740991", org_id: "org" });
    await expect(allocateDocumentNumber("invoice", [], { invoice: "INV-{001}" })).rejects.toThrow("counter is exhausted");
    expect(await loadColl("document_number_reservations")).toEqual([]);
  });
});
describe("stored document number uniqueness", () => {
  it("blocks normalized duplicates and permits editing legacy duplicate rows unchanged", () => {
    const before = [{ id: 1, number: "INV-1" }, { id: 2, number: "INV-1" }];
    expect(() => validateNumberedCollection("invoice_docs", before, [{ ...before[0], notes: "updated" }, before[1]])).not.toThrow();
    expect(() => validateNumberedCollection("invoice_docs", before, [...before, { id: 3, number: " inv-1 " }])).toThrow("already in use");
    expect(() => validateNumberedCollection("invoice_docs", [{ id: 1, number: "A" }, { id: 2, number: "B" }], [{ id: 1, number: "B" }, { id: 2, number: "B" }])).toThrow("already in use");
  });
  it("guards embedded collection numbers, preserves legacy duplicate edits, and refuses corruption", () => {
    const old = { id: 1, key: "letters", value: JSON.stringify([{ id: "a", form: { number: "A" } }, { id: "b", form: { number: "A" } }]) };
    expect(() => validateNumberedCollection("app_settings", [old], [{ ...old, value: JSON.stringify([{ id: "a", form: { number: "A", notes: "edited" } }, { id: "b", form: { number: "A" } }]) }])).not.toThrow();
    expect(() => validateNumberedCollection("app_settings", [old], [{ ...old, value: JSON.stringify([{ id: "a", form: { number: "A" } }, { id: "new", form: { number: "a" } }]) }])).toThrow("already in use");
    expect(() => validateNumberedCollection("app_settings", [old], [{ ...old, value: JSON.stringify([{ id: "a", form: { number: "A" } }, { id: "a", form: { number: "A" } }]) }])).toThrow("identity cannot be duplicated");
    expect(() => validateNumberedCollection("app_settings", [], [{ id: 1, key: "letters", value: "{}" }])).toThrow("Original records were preserved");
  });
});
