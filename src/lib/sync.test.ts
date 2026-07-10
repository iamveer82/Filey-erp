// Auto-sync: journal records local writes; syncNow pushes dirty tables to a
// (fake) cloud client — upserts by id, deletes deleted ids, strips ownership.
import { describe, it, expect, beforeEach } from "vitest";
import { localClient, journalSnapshot } from "./localdb";
import { syncNow, cleanRowForPush } from "./sync";

// syncNow only runs in local mode.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

const UID = "11111111-2222-3333-4444-555555555555";

// Minimal fake of the supabase-js surface syncNow touches. Records every call.
function fakeCloud() {
  const calls: { table: string; op: string; payload?: any; ids?: any[] }[] = [];
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: UID } } } };
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
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          return {
            in(_col: string, ids: any[]) {
              calls.push({ table, op: "delete", ids });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as any, calls };
}

describe("local write journal", () => {
  it("marks synced collections dirty and records deleted ids", async () => {
    await localClient.from("products").insert({ name: "Widget" });
    await localClient.from("products").update({ name: "Widget 2" }).eq("id", 1);
    await localClient.from("products").delete().eq("id", 1);

    const j = await journalSnapshot();
    expect(j.tables.products).toBeTruthy();
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

  it("does nothing without a session", async () => {
    await localClient.from("products").insert({ name: "A" });
    const { client, calls } = fakeCloud();
    client.auth.getSession = async () => ({ data: { session: null } });
    expect(await syncNow(client)).toBe(false);
    expect(calls).toHaveLength(0);
    const j = await journalSnapshot();
    expect(j.tables.products).toBeTruthy(); // still pending
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
