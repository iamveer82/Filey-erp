import { beforeEach, describe, expect, it } from "vitest";
import { localClient as c } from "../localdb";

// jsdom provides localStorage; localdb falls back to it when not under Tauri.
beforeEach(() => localStorage.clear());

describe("localdb query shim", () => {
  it("inserts with an id and reads it back", async () => {
    const { data: ins } = await c.from("widgets").insert({ name: "A" }).select().single();
    expect(ins.id).toBe(1);
    expect(ins.created_at).toBeTruthy();
    const { data: rows } = await c.from("widgets").select();
    expect(rows).toHaveLength(1);
  });

  it("filters with eq and returns single", async () => {
    await c.from("widgets").insert([{ name: "A" }, { name: "B" }]);
    const { data } = await c.from("widgets").select().eq("name", "B").single();
    expect(data.name).toBe("B");
    expect(data.id).toBe(2);
  });

  it("eq matches a string param against a numeric stored id (PostgREST coercion)", async () => {
    const { data: ins } = await c.from("widgets").insert({ name: "A" }).select().single();
    expect(typeof ins.id).toBe("number"); // shim auto-assigns numeric id
    // A route param arrives as a string — must still find the row.
    const { data } = await c.from("widgets").select().eq("id", String(ins.id)).single();
    expect(data?.name).toBe("A");
  });

  it("single errors when no row matches", async () => {
    const { data, error } = await c.from("widgets").select().eq("name", "X").single();
    expect(data).toBeNull();
    expect(error.code).toBe("PGRST116");
  });

  it("updates matching rows", async () => {
    await c.from("widgets").insert({ name: "A", qty: 1 });
    await c.from("widgets").update({ qty: 5 }).eq("name", "A");
    const { data } = await c.from("widgets").select().eq("name", "A").single();
    expect(data.qty).toBe(5);
  });

  it("deletes matching rows", async () => {
    await c.from("widgets").insert([{ name: "A" }, { name: "B" }]);
    await c.from("widgets").delete().eq("name", "A");
    const { data } = await c.from("widgets").select();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("B");
  });

  it("orders and limits", async () => {
    await c.from("n").insert([{ v: 3 }, { v: 1 }, { v: 2 }]);
    const { data } = await c.from("n").select().order("v", { ascending: true }).limit(2);
    expect(data.map((r: any) => r.v)).toEqual([1, 2]);
  });

  it("multi-key order is date-wise and stable across updates", async () => {
    await c.from("d").insert([
      { issue_date: "2026-01-01", n: "A" },
      { issue_date: "2026-03-01", n: "B" },
      { issue_date: "2026-02-01", n: "C" },
    ]);
    // Editing the oldest must NOT bump it to the top (no updated_at sort).
    await c.from("d").update({ n: "A2" }).eq("n", "A");
    const { data } = await c
      .from("d")
      .select()
      .order("issue_date", { ascending: false })
      .order("id", { ascending: false });
    expect(data.map((r: any) => r.issue_date)).toEqual([
      "2026-03-01",
      "2026-02-01",
      "2026-01-01",
    ]);
  });

  it("upsert replaces on id conflict", async () => {
    await c.from("w").insert({ name: "A" });
    await c.from("w").upsert({ id: 1, name: "A2" });
    const { data } = await c.from("w").select();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("A2");
  });

  it("persists across separate builder calls (same store)", async () => {
    await c.from("p").insert({ name: "keep" });
    const raw = localStorage.getItem("localdb:p");
    expect(raw).toContain("keep");
  });

  it("storage round-trips bytes via base64 and serves a data URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    // jsdom's Blob has no arrayBuffer(); the shim only needs arrayBuffer + type.
    const blob: any = { type: "application/pdf", arrayBuffer: async () => bytes.buffer };
    const store = c.storage.from("files");
    const up = await store.upload("u/1/x.pdf", blob, { contentType: "application/pdf" });
    expect(up.error).toBeNull();

    const { data: signed } = await store.createSignedUrl("u/1/x.pdf");
    const expected = btoa(String.fromCharCode(...bytes));
    expect(signed!.signedUrl).toBe(`data:application/pdf;base64,${expected}`);

    // Decode the data URL back to bytes — verifies the full round-trip.
    const b64 = signed!.signedUrl.split(",")[1];
    const decoded = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    expect(Array.from(decoded)).toEqual([1, 2, 3, 250, 255]);

    await store.remove(["u/1/x.pdf"]);
    const after = await store.createSignedUrl("u/1/x.pdf");
    expect(after.error).toBeTruthy();
  });
});
