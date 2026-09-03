// Auto-sync: journal records local writes per row; syncNow pushes the changed
// rows to a (fake) cloud client — upserts by id, deletes deleted ids, strips
// ownership, flags org sharing; pullNow brings cloud rows down into clean
// collections.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient, journalSnapshot, replaceColl } from "./localdb";
import { syncNow, pullNow, syncCycle, cleanRowForPush, getSyncStatus } from "./sync";

// syncNow only runs in local mode.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const UID = "11111111-2222-3333-4444-555555555555";

// Minimal fake of the supabase-js surface sync touches. Records every call.
// opts: uid (session user), org (profiles.org_id), failTables (upsert errors),
// pull (rows served per table to select().order().range()).
function fakeCloud(opts?: {
  uid?: string;
  org?: string;
  failTables?: string[];
  pull?: Record<string, any[]>;
  /** Seconds from now the access token dies. Default: comfortably alive. */
  expiresInSecs?: number;
}) {
  const uid = opts?.uid ?? UID;
  const refreshes: number[] = [];
  const calls: { table: string; op: string; payload?: any; ids?: any[] }[] = [];
  // supabase-js stores the session and a refresh REPLACES it, so the next
  // getSession sees the new expiry. Modelling that matters: the push checks the
  // token per table, and a fake that kept handing back the dying token would
  // make one refresh look like one per table.
  let session = {
    user: { id: uid },
    expires_at: Math.floor(Date.now() / 1000) + (opts?.expiresInSecs ?? 3600),
  };
  const client = {
    auth: {
      async getSession() {
        return { data: { session } };
      },
      async refreshSession() {
        refreshes.push(Date.now());
        session = { user: { id: uid }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
        return { data: { session }, error: null };
      },
    },
    async rpc(name: string) {
      calls.push({ table: "(rpc)", op: name });
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        async upload() {
          return { data: null, error: null };
        },
      }),
    },
    from(table: string) {
      return {
        upsert(rows: any[], _opts?: any) {
          calls.push({ table, op: "upsert", payload: rows });
          const error = opts?.failTables?.includes(table)
            ? { message: "boom" }
            : null;
          return Promise.resolve({ data: null, error });
        },
        delete() {
          return {
            in(_col: string, ids: any[]) {
              calls.push({ table, op: "delete", ids });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        select(cols: string) {
          const rows = opts?.pull?.[table] ?? [];
          // The incremental pull asks for "id, updated_at" first, so the fake
          // has to actually honour the column list — a mock that always
          // returned whole rows would hide the egress saving under test.
          const project = (r: any) =>
            cols === "*"
              ? r
              : Object.fromEntries(
                  cols.split(",").map((c) => [c.trim(), r[c.trim()]])
                );
          const chain: any = {
            order: () => chain,
            range: (from: number, to: number) =>
              Promise.resolve({ data: rows.slice(from, to + 1).map(project), error: null }),
            in(_col: string, ids: any[]) {
              calls.push({ table, op: "select-in", ids });
              const want = new Set(ids.map(String));
              return Promise.resolve({
                data: rows.filter((r) => want.has(String(r.id))).map(project),
                error: null,
              });
            },
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    table === "profiles"
                      ? { org_id: opts?.org ?? "default" }
                      : null,
                  error: null,
                }),
            }),
          };
          return chain;
        },
      };
    },
  };
  return { client: client as any, calls, refreshes };
}

describe("local write journal", () => {
  it("marks changed row ids and records deleted ids", async () => {
    await localClient.from("products").insert({ name: "Widget" });
    await localClient.from("products").update({ name: "Widget 2" }).eq("id", 1);
    await localClient.from("products").delete().eq("id", 1);

    const j = await journalSnapshot();
    expect(j.tables.products).toBeTruthy();
    expect(j.tables.products.changed).toEqual([1]);
    expect(j.tables.products.deleted).toEqual([1]);
  });

  it("ignores collections the cloud doesn't take", async () => {
    await localClient.from("notifications").insert({ body: "hi" });
    const j = await journalSnapshot();
    expect(j.tables.notifications).toBeUndefined();
  });
});

describe("syncNow", () => {
  it("pushes dirty tables (upsert + delete), strips ownership, clears journal", async () => {
    await localClient.from("products").insert({ name: "A", org_id: "local", user_id: "x" });
    await localClient.from("products").insert({ name: "B" });
    await localClient.from("products").delete().eq("id", 2);

    const { client, calls } = fakeCloud();
    expect(await syncNow(client)).toBe(true);

    const del = calls.find((c) => c.table === "products" && c.op === "delete");
    expect(del?.ids).toEqual([2]);

    const up = calls.find((c) => c.table === "products" && c.op === "upsert");
    expect(up?.payload).toHaveLength(1);
    expect(up?.payload[0].name).toBe("A");
    expect(up?.payload[0].org_id).toBeUndefined();
    expect(up?.payload[0].user_id).toBeUndefined();

    // sequences bumped + bookkeeping written
    expect(calls.some((c) => c.op === "sync_bump_sequences")).toBe(true);
    expect(calls.some((c) => c.table === "sync_state" && c.op === "upsert")).toBe(true);

    // journal now clean → second run pushes nothing new
    const j = await journalSnapshot();
    expect(j.tables.products).toBeUndefined();
    const before = calls.length;
    expect(await syncNow(client)).toBe(true);
    expect(calls.length).toBe(before);
  });

  it("pushes only the rows that changed since the last sync", async () => {
    await localClient.from("products").insert({ name: "A" });
    await localClient.from("products").insert({ name: "B" });
    const { client, calls } = fakeCloud();
    await syncNow(client);

    await localClient.from("products").update({ name: "A2" }).eq("id", 1);
    await syncNow(client);

    const ups = calls.filter((c) => c.table === "products" && c.op === "upsert");
    expect(ups[0].payload).toHaveLength(2);
    expect(ups[1].payload).toHaveLength(1);
    expect(ups[1].payload[0].name).toBe("A2");
  });

  it("keeps rows that failed to push marked for retry", async () => {
    await localClient.from("products").insert({ name: "A" });
    const { client } = fakeCloud({ failTables: ["products"] });
    await syncNow(client);

    const j = await journalSnapshot();
    expect(j.tables.products?.changed).toEqual([1]);
  });

  it("does nothing without a session", async () => {
    await localClient.from("products").insert({ name: "A" });
    const { client, calls } = fakeCloud();
    client.auth.getSession = async () => ({ data: { session: null } });
    expect(await syncNow(client)).toBe(false);
    expect(calls).toHaveLength(0);
    const j = await journalSnapshot();
    expect(j.tables.products).toBeTruthy(); // still pending
  });

  // "Upload all local data" pressed with auto-sync switched off used to return
  // false in silence, so the button did nothing and explained nothing.
  it("skips a background run when auto-sync is off", async () => {
    await localClient.from("products").insert({ name: "A" });
    localStorage.setItem("filey_auto_sync", "off");
    const { client, calls } = fakeCloud();
    expect(await syncNow(client)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("still pushes on a manual run when auto-sync is off", async () => {
    await localClient.from("products").insert({ name: "A" });
    localStorage.setItem("filey_auto_sync", "off");
    const { client, calls } = fakeCloud();
    expect(await syncNow(client, { manual: true })).toBe(true);
    expect(calls.some((c) => c.table === "products" && c.op === "upsert")).toBe(true);
  });

  it("reports why a manual run stopped instead of failing silently", async () => {
    await localClient.from("products").insert({ name: "A" });
    const { client } = fakeCloud();
    client.auth.getSession = async () => ({ data: { session: null } });
    expect(await syncNow(client, { manual: true })).toBe(false);
    const s = getSyncStatus();
    expect(s.state).toBe("error");
    expect(s.error ?? "").toMatch(/sign in/i);
  });
});

describe("org sharing", () => {
  it("flags business rows shared for real-org members, never in org 'default'", async () => {
    await localClient.from("products").insert({ name: "A" });
    const team = fakeCloud({ uid: "uid-team", org: "team-1" });
    await syncNow(team.client);
    const up = team.calls.find((c) => c.table === "products" && c.op === "upsert");
    expect(up?.payload[0].shared).toBe(true);

    // SECURITY: org 'default' is where every solo account lives — sharing
    // there would leak rows to unrelated users.
    await localClient.from("products").update({ name: "B" }).eq("id", 1);
    const solo = fakeCloud({ uid: "uid-solo", org: "default" });
    await syncNow(solo.client);
    const up2 = solo.calls.find((c) => c.table === "products" && c.op === "upsert");
    expect(up2?.payload[0].shared).toBeUndefined();
  });
});

describe("pullNow", () => {
  it("replaces clean collections from the cloud and skips dirty ones", async () => {
    await localClient.from("orders").insert({ order_number: "LOCAL-1" }); // dirty
    const { client } = fakeCloud({
      pull: {
        products: [{ id: 9, name: "Cloud widget" }],
        orders: [{ id: 5, order_number: "CLOUD-5" }],
      },
    });
    expect(await pullNow(client)).toBe(true);

    const { data: prods } = await localClient.from("products").select("*");
    expect(prods).toEqual([{ id: 9, name: "Cloud widget" }]);

    // dirty table untouched — local edits win until pushed
    const { data: ords } = await localClient.from("orders").select("*");
    expect(ords).toHaveLength(1);
    expect(ords?.[0].order_number).toBe("LOCAL-1");
  });

  it("push then pull propagates remote deletes without touching new local rows", async () => {
    await localClient.from("products").insert({ name: "A" });
    const { client } = fakeCloud({ pull: { products: [] } });
    await syncNow(client); // journal clean now
    expect(await pullNow(client)).toBe(true);
    const { data } = await localClient.from("products").select("*");
    expect(data).toEqual([]); // cloud says gone (deleted on another device)
  });

  it("downloads row bodies only for rows whose updated_at moved", async () => {
    const cloud = [
      { id: 1, name: "Untouched", updated_at: "2026-01-01T00:00:00Z" },
      { id: 2, name: "Edited elsewhere", updated_at: "2026-02-02T00:00:00Z" },
    ];
    // Planted without journal entries, so the table is clean and pullable.
    await replaceColl("products", [
      { id: 1, name: "Untouched", updated_at: "2026-01-01T00:00:00Z" },
      { id: 2, name: "Stale copy", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    const { client, calls } = fakeCloud({ pull: { products: cloud } });
    expect(await pullNow(client)).toBe(true);

    // Row 1 was never re-downloaded — that is the egress saving.
    const bodies = calls.filter((c) => c.table === "products" && c.op === "select-in");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].ids).toEqual([2]);
    // …and the collection still matches the cloud exactly.
    const { data } = await localClient.from("products").select("*");
    expect(data).toEqual(cloud);
  });

  it("skips the body fetch entirely when nothing changed", async () => {
    const cloud = [{ id: 1, name: "Same", updated_at: "2026-01-01T00:00:00Z" }];
    await replaceColl("products", cloud);
    const { client, calls } = fakeCloud({ pull: { products: cloud } });
    expect(await pullNow(client)).toBe(true);
    expect(calls.some((c) => c.table === "products" && c.op === "select-in")).toBe(false);
  });

  it("still full-snapshots tables that have no updated_at trigger", async () => {
    // crm_people is pushed but carries no set_updated_at trigger in schema.sql,
    // so it must keep coming down whole or edits there would go missing.
    const { client, calls } = fakeCloud({ pull: { crm_people: [{ id: 3, name: "Ada" }] } });
    expect(await pullNow(client)).toBe(true);
    expect(calls.some((c) => c.table === "crm_people" && c.op === "select-in")).toBe(false);
    const { data } = await localClient.from("crm_people").select("*");
    expect(data).toEqual([{ id: 3, name: "Ada" }]);
  });
});

describe("syncCycle first-run seeding", () => {
  it("pushes pre-journal local data before any pull can replace it", async () => {
    // Rows planted WITHOUT journal entries = data that predates auto-sync.
    await replaceColl("products", [{ id: 1, name: "Legacy row" }]);
    const { client, calls } = fakeCloud({ pull: { products: [] } });

    await syncCycle(client);

    // Seeded → pushed; and the empty cloud snapshot must NOT have wiped the
    // local row before that push happened.
    const up = calls.find((c) => c.table === "products" && c.op === "upsert");
    expect(up?.payload[0].name).toBe("Legacy row");
    expect(localStorage.getItem("filey_cloud_seeded")).toBe("1");
  });
});

describe("cleanRowForPush", () => {
  it("re-stamps owner and remaps local storage paths", () => {
    const out = cleanRowForPush(
      { id: 1, owner: "local-user", storage_path: "local-user/docs/a.pdf", org_id: "o", user_id: "u" },
      UID
    );
    expect(out).toEqual({ id: 1, owner: UID, storage_path: `${UID}/docs/a.pdf` });
  });
});

describe('expired session', () => {
  // supabase-js refreshes on a timer, and a timer does not run while a laptop
  // sleeps. A desktop waking after the token's hour is up pushed with a dead
  // JWT and the first table in PUSH_TABLES failed — which is why the report
  // always named company_profile rather than the real cause.
  it('refreshes before pushing when the token is about to expire', async () => {
    await localClient.from('products').insert({ name: 'Widget' });
    const { client, refreshes } = fakeCloud({ expiresInSecs: 10 });
    await syncNow(client, { manual: true });
    expect(refreshes.length).toBe(1);
  });

  it('does not refresh a token with plenty of life left', async () => {
    await localClient.from('products').insert({ name: 'Widget' });
    const { client, refreshes } = fakeCloud({ expiresInSecs: 3600 });
    await syncNow(client, { manual: true });
    expect(refreshes.length).toBe(0);
  });

  // A first seed is every table at once and takes far longer than the 60s of
  // headroom the opening check buys. The token used to be read once, so when it
  // died partway the rest of the run failed as "JWT expired" — a message that
  // names the first table in PUSH_TABLES and nothing about signing in.
  it('stops with a sign-in message when the session dies mid-push', async () => {
    await localClient.from('products').insert({ name: 'Widget' });
    await localClient.from('customers').insert({ name: 'Acme' });
    const { client } = fakeCloud();
    // Alive for the opening check, gone by the time the first table is done.
    let calls = 0;
    client.auth.getSession = async () =>
      ({ data: { session: calls++ < 1 ? { user: { id: UID }, expires_at: Math.floor(Date.now() / 1000) + 3600 } : null } }) as any;

    expect(await syncNow(client, { manual: true })).toBe(false);
    const s = getSyncStatus();
    expect(s.state).toBe('error');
    expect(s.error ?? '').toMatch(/sign in/i);
  });
});
