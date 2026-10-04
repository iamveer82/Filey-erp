import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localClient } from "../localdb";
import { requireModuleAccess } from "../moduleAccess";
import {
  blankPackagingForm, deletePackagingList, loadPackagingLists, packagingTotals,
  savePackagingList, validatePackagingForm, PACKAGING_SETTING_KEY,
  type PackagingForm, type PackagingRecord,
} from "../packagingLists";

const identity = vi.hoisted(() => ({ scope: "org:user:account", userId: "account" }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope || null }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: vi.fn(async () => {}) }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { sb: vi.fn(() => localStorage.getItem("filey_data_mode") !== "cloud" ? localClient : {
    from: (table: string) => {
      const query = localClient.from(table), insert = query.insert.bind(query);
      query.insert = rows => insert(Array.isArray(rows) ? rows.map(row => ({ sync_revision: 1, ...row })) : { sync_revision: 1, ...rows });
      return query;
    },
  }), supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: identity.userId } } }, error: null }) } } };
});

const form = (number = "PL-001"): PackagingForm => {
  const blank = blankPackagingForm(number);
  return { ...blank, recipient_name: "Standalone customer", items: [{ ...blank.items[0], description: "Pump", qty: 2, package_type: "Carton", package_count: 1, net_weight: 3, gross_weight: 3.5 }] };
};
const record = (number: string, id = crypto.randomUUID()): PackagingRecord => ({
  id, revision: 1, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", form: form(number),
});
const cloud = (org = "org", user = "account") => {
  localStorage.setItem("filey_data_mode", "cloud"); identity.userId = user; identity.scope = `${org}:user:${user}`;
};
const seed = async (records: PackagingRecord[], extra = {}) => {
  const result = await localClient.from("app_settings").insert({ key: PACKAGING_SETTING_KEY, value: JSON.stringify(records), sync_revision: 1, ...extra }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id as number;
};
const stored = () => JSON.parse(localStorage.getItem("localdb:app_settings") || "[]") as { id: number; key: string; value: string; sync_revision?: number }[];
const replaceRecords = (records: PackagingRecord[]) => {
  const rows = stored(); rows[0].value = JSON.stringify(records); rows[0].sync_revision = (rows[0].sync_revision ?? 0) + 1; localStorage.setItem("localdb:app_settings", JSON.stringify(rows));
};

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:account"; identity.userId = "account";
  vi.mocked(requireModuleAccess).mockResolvedValue();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("packaging documents", () => {
  it("totals explicit package counts and per-item weights without combining quantity units", () => {
    const item = form().items[0];
    const totals = packagingTotals([item, { ...item, qty: 4, unit: "kg", package_count: null, net_weight: null, gross_weight: null }, { ...item, qty: 3, unit: "pcs", package_count: 2, net_weight: 1, gross_weight: 1.5 }]);
    expect(totals).toEqual({ packages: 3, net: 9, gross: 11.5, quantities: { pcs: 5, kg: 4 } });
    expect(packagingTotals([{ ...item, unit: "__proto__" }]).quantities.__proto__).toBe(2);
  });

  it("validates real dates, finite positive quantities, integral packages and net/gross weights", () => {
    const valid = form();
    expect(() => validatePackagingForm(valid)).not.toThrow();
    expect(() => validatePackagingForm({ ...valid, invoice_id: null, invoice_reference: "" })).not.toThrow();
    for (const qty of [0, -1, NaN, Infinity]) expect(() => validatePackagingForm({ ...valid, items: [{ ...valid.items[0], qty }] })).toThrow("quantities");
    for (const package_count of [-1, 0.5, Infinity]) expect(() => validatePackagingForm({ ...valid, items: [{ ...valid.items[0], package_count }] })).toThrow("Package counts");
    for (const net_weight of [-1, NaN, Infinity]) expect(() => validatePackagingForm({ ...valid, items: [{ ...valid.items[0], net_weight }] })).toThrow("Weights");
    expect(() => validatePackagingForm({ ...valid, items: [{ ...valid.items[0], gross_weight: 1 }] })).toThrow("Net weight");
    expect(() => validatePackagingForm({ ...valid, issue_date: "2026-02-30" })).toThrow("dates");
    expect(() => validatePackagingForm({ ...valid, dispatch_date: "bad date" })).toThrow("dates");
    expect(() => validatePackagingForm({ ...valid, recipient_address: "a".repeat(401) })).toThrow("400");
    expect(() => validatePackagingForm({ ...valid, number: "PL\n002" })).toThrow("single line");
    expect(() => validatePackagingForm({ ...valid, recipient_address: Array(7).fill("Address line").join("\n") })).toThrow("six lines");
    expect(() => validatePackagingForm({ ...valid, notes: "Note\n".repeat(20), items: [{ ...valid.items[0], description: "Pump\nDetailed description" }] })).not.toThrow();
    expect(() => validatePackagingForm({ ...valid, items: [valid.items[0], valid.items[0]] })).toThrow("unique ID");
  });

  it("round-trips standalone lists, preserves IDs/creation dates on edit, and never touches financial or stock rows", async () => {
    const created = await savePackagingList(form());
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.revision).toBe(1);
    const edited = await savePackagingList({ ...created.form, status: "dispatched", invoice_reference: "Optional reference only" }, created.id, created.revision, created.updated_at);
    expect(edited.id).toBe(created.id);
    expect(edited.created_at).toBe(created.created_at);
    expect(edited.revision).toBe(2);
    expect(await loadPackagingLists()).toEqual([edited]);
    expect(edited.form.invoice_id).toBeNull();
    for (const table of ["invoice_docs", "stock_movements", "transactions", "crm_customers", "products"])
      expect(localStorage.getItem(`localdb:${table}`)).toBeNull();
    await deletePackagingList(edited.id, edited.revision, edited.updated_at);
    expect(await loadPackagingLists()).toEqual([]);
  });

  it("merges simultaneous same-window saves and rejects stale edits/deletes of the same document", async () => {
    const [first, second] = await Promise.all([savePackagingList(form("PL-A")), savePackagingList(form("PL-B"))]);
    expect((await loadPackagingLists()).map(row => row.id)).toEqual([second.id, first.id]);
    const latest = await savePackagingList({ ...first.form, notes: "Updated" }, first.id, first.revision, first.updated_at);
    await expect(savePackagingList(first.form, first.id, first.revision, first.updated_at)).rejects.toThrow("changed or was deleted");
    await expect(deletePackagingList(first.id, first.revision, first.updated_at)).rejects.toThrow("changed or was deleted");
    expect((await loadPackagingLists()).find(row => row.id === first.id)).toEqual(latest);
    await expect(savePackagingList(form("pl-a"))).rejects.toThrow("already in use");
  });

  it("rejects equal-revision sync replacements and gives rapid saves distinct timestamps", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-02T00:00:00Z"));
    const first = await savePackagingList(form());
    await expect(savePackagingList(first.form, first.id, first.revision)).rejects.toThrow("changed or was deleted");
    const second = await savePackagingList({ ...first.form, notes: "First edit" }, first.id, first.revision, first.updated_at);
    expect(Date.parse(second.updated_at)).toBe(Date.parse(first.updated_at) + 1);
    const replacement = { ...second, updated_at: new Date(Date.parse(second.updated_at) + 1).toISOString(), form: { ...second.form, notes: "Offline version chosen during sync" } };
    replaceRecords([replacement]);
    await expect(savePackagingList(second.form, second.id, second.revision, second.updated_at)).rejects.toThrow("changed or was deleted");
    await expect(deletePackagingList(second.id, second.revision, second.updated_at)).rejects.toThrow("changed or was deleted");
    expect(await loadPackagingLists()).toEqual([replacement]);
  });

  it("preserves a record whose revision cannot be incremented safely", async () => {
    const previous = { ...record("PL-MAX"), revision: Number.MAX_SAFE_INTEGER };
    await seed([previous]);
    await expect(savePackagingList(previous.form, previous.id, previous.revision, previous.updated_at)).rejects.toThrow("revision is too large");
    expect(await loadPackagingLists()).toEqual([previous]);
  });

  it("preserves malformed records and duplicate setting rows rather than replacing them", async () => {
    await seed([record("PL-OLD")]);
    // Simulate historical damaged bytes; current mutation APIs reject them.
    const damaged = stored(); damaged[0].value = "{damaged-original";
    localStorage.setItem("localdb:app_settings", JSON.stringify(damaged));
    const original = localStorage.getItem("localdb:app_settings");
    await expect(loadPackagingLists()).rejects.toThrow("original data has been preserved");
    await expect(savePackagingList(form())).rejects.toThrow("original data has been preserved");
    expect(localStorage.getItem("localdb:app_settings")).toBe(original);
    replaceRecords([{ ...record("PL-OLD"), revision: 0 }]);
    await expect(loadPackagingLists()).rejects.toThrow("original data has been preserved");
    await seed([]);
    await expect(savePackagingList(form())).rejects.toThrow("duplicate settings");
  });

  it("does not report failed persistence as a saved document", async () => {
    await savePackagingList(form("PL-OLD"));
    const original = localStorage.getItem("localdb:app_settings");
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "localdb:app_settings") throw new Error("Disk is full");
      setItem.call(this, key, value);
    });
    await expect(savePackagingList(form("PL-NEW"))).rejects.toThrow("Disk is full");
    expect(localStorage.getItem("localdb:app_settings")).toBe(original);
  });

  it("keeps organizations separate, denies signed-out/forbidden access and fails offline cloud saves", async () => {
    cloud();
    const first = await savePackagingList(form("PL-ORG"));
    cloud("another-org");
    expect(await loadPackagingLists()).toEqual([]);
    await savePackagingList(form("PL-OTHER"));
    cloud();
    expect(await loadPackagingLists()).toEqual([first]);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(savePackagingList(form("PL-OFFLINE"))).rejects.toThrow("Connect to the internet");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(requireModuleAccess).mockRejectedValue(new Error("Module denied"));
    await expect(loadPackagingLists()).rejects.toThrow("Module denied");
    await expect(deletePackagingList(first.id, first.revision, first.updated_at)).rejects.toThrow("Module denied");
    identity.scope = "";
    await expect(loadPackagingLists()).rejects.toThrow("Sign in");
    await expect(savePackagingList(form())).rejects.toThrow("Sign in");
  });
});

describe("cloud packaging races", () => {
  const raceOnUpdate = (race: () => void) => {
    const from = localClient.from.bind(localClient);
    vi.spyOn(localClient, "from").mockImplementation(table => {
      const query = from(table), update = query.update.bind(query);
      vi.spyOn(query, "update").mockImplementation(value => { race(); return update(value); });
      return query;
    });
  };

  it("retries a known CAS miss with a fresh merge, preserving unrelated documents", async () => {
    cloud(); const first = record("PL-FIRST"), other = record("PL-OTHER");
    await seed([first], { user_id: identity.userId, org_id: "org" });
    let raced = false;
    raceOnUpdate(() => { if (!raced) { raced = true; replaceRecords([other, first]); } });
    const saved = await savePackagingList(form("PL-NEW"));
    expect((await loadPackagingLists()).map(row => row.id)).toEqual([saved.id, other.id, first.id]);
  });

  it("uses a small server revision filter for cloud CAS and refuses unverifiable revisions", async () => {
    cloud(); const first = record("PL-LARGE"); first.form.company_logo = `data:image/png;base64,${"a".repeat(100000)}`;
    await seed([first], { user_id: identity.userId, org_id: "org" });
    const from = localClient.from.bind(localClient), filters: [string, unknown][] = [];
    vi.spyOn(localClient, "from").mockImplementation(table => {
      const query = from(table), eq = query.eq.bind(query);
      vi.spyOn(query, "eq").mockImplementation((column, value) => { filters.push([column, value]); return eq(column, value); });
      return query;
    });
    await savePackagingList({ ...first.form, notes: "Updated" }, first.id, first.revision, first.updated_at);
    expect(filters).toContainEqual(["sync_revision", 1]);
    expect(filters.some(([column]) => column === "value")).toBe(false);
    await localClient.from("app_settings").update({ sync_revision: null }).eq("key", PACKAGING_SETTING_KEY);
    const original = localStorage.getItem("localdb:app_settings");
    await expect(savePackagingList(form("PL-NO-REVISION"))).rejects.toThrow("update the cloud database");
    expect(localStorage.getItem("localdb:app_settings")).toBe(original);
  });

  it("rejects a same-record race after its CAS miss", async () => {
    cloud(); const first = record("PL-FIRST");
    await seed([first], { user_id: identity.userId, org_id: "org" });
    raceOnUpdate(() => replaceRecords([{ ...first, revision: 2, form: { ...first.form, notes: "Other window" } }]));
    await expect(savePackagingList(first.form, first.id, first.revision, first.updated_at)).rejects.toThrow("changed or was deleted");
    expect((await loadPackagingLists())[0].form.notes).toBe("Other window");
  });

  it("bounds CAS retries and never retries an unknown network outcome", async () => {
    cloud(); const first = record("PL-FIRST");
    await seed([first], { user_id: identity.userId, org_id: "org" });
    let changes = 0;
    raceOnUpdate(() => replaceRecords([{ ...first, revision: ++changes + 1 }]));
    await expect(savePackagingList(form("PL-NEW"))).rejects.toThrow("another window");
    expect(changes).toBe(3);
    vi.restoreAllMocks();
    const from = localClient.from.bind(localClient);
    let attempts = 0;
    vi.spyOn(localClient, "from").mockImplementation(table => {
      const query = from(table), update = query.update.bind(query);
      vi.spyOn(query, "update").mockImplementation(value => {
        attempts++; update(value);
        vi.spyOn(query, "maybeSingle").mockImplementation(() => Promise.resolve({ data: null, error: new Error("Network outcome unknown") }) as never);
        return query;
      });
      return query;
    });
    await expect(savePackagingList(form("PL-UNKNOWN"))).rejects.toThrow("Network outcome unknown");
    expect(attempts).toBe(1);
  });

  it("freshly merges a first-insert unique violation instead of creating a second collection", async () => {
    cloud(); const other = record("PL-OTHER"), from = localClient.from.bind(localClient);
    let raced = false;
    vi.spyOn(localClient, "from").mockImplementation(table => {
      const query = from(table);
      vi.spyOn(query, "insert").mockImplementation(() => {
        if (!raced) { raced = true; localStorage.setItem("localdb:app_settings", JSON.stringify([{ id: 1, key: PACKAGING_SETTING_KEY, value: JSON.stringify([other]), sync_revision: 1, user_id: identity.userId, org_id: "org" }])); }
        return { select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) } as never;
      });
      return query;
    });
    const saved = await savePackagingList(form("PL-NEW"));
    expect((await loadPackagingLists()).map(row => row.id)).toEqual([saved.id, other.id]);
    expect(stored()).toHaveLength(1);
  });

  it("rejects delayed reads and queued writes when the active workspace changes", async () => {
    let finish!: () => void;
    const permission = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(requireModuleAccess).mockReturnValueOnce(permission);
    const reading = loadPackagingLists();
    identity.scope = "next:user:account"; finish();
    await expect(reading).rejects.toThrow("workspace changed");
    identity.scope = "org:user:account";
    const saving = savePackagingList(form());
    localStorage.setItem("filey_data_mode", "cloud");
    await expect(saving).rejects.toThrow("workspace changed");
    expect(stored()).toHaveLength(0);
  });
});
