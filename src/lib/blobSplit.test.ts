// Oversized string fields (the base64 logo an invoice was issued with) are
// stored once under their own key, with the row keeping a {__blob} marker.
// Without it, writing one invoice re-serialised every logo of every invoice:
// 2000 docs with a 150KB logo each built a 308MB string per save.
//
// What must stay true: callers never see a marker, the same logo is stored
// once however many docs carry it, rows written before this existed still
// load, and sync gets real values rather than markers.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { localClient, loadColl, replaceColl, clearLocalCache } from "./localdb";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  clearLocalCache();
});

const LOGO = "data:image/png;base64," + "R".repeat(40_000);
const OTHER = "data:image/png;base64," + "Q".repeat(40_000);

const blobKeys = () =>
  Object.keys(localStorage).filter((k) => k.startsWith("localdb:blob:"));

describe("blob split", () => {
  it("hands back the real value, not the marker", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", logo: LOGO });
    clearLocalCache(); // force a real read back from storage

    const { data } = await localClient.from("invoice_docs").select("*");
    expect(data?.[0].logo).toBe(LOGO);
    expect(data?.[0].number).toBe("INV-1");
  });

  it("keeps the payload out of the collection blob", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", logo: LOGO });
    const stored = localStorage.getItem("localdb:invoice_docs") ?? "";
    expect(stored).not.toContain("RRRR");
    expect(stored).toContain("__blob");
    // The whole point: the collection stays small no matter the logo.
    expect(stored.length).toBeLessThan(500);
  });

  it("stores one copy however many rows carry the same logo", async () => {
    await localClient
      .from("invoice_docs")
      .insert(
        Array.from({ length: 50 }, (_, i) => ({ number: `INV-${i}`, logo: LOGO }))
      );
    expect(blobKeys()).toHaveLength(1);

    // The size claim, stated against what it replaces: 50 inline copies of a
    // 40KB logo is ~2MB re-serialised on every write to this collection.
    const stored = localStorage.getItem("localdb:invoice_docs") ?? "";
    expect(stored.length).toBeLessThan(50 * LOGO.length * 0.01);
  });

  it("keeps distinct logos apart", async () => {
    await localClient.from("invoice_docs").insert([
      { number: "A", logo: LOGO },
      { number: "B", logo: OTHER },
    ]);
    clearLocalCache();
    expect(blobKeys()).toHaveLength(2);

    const { data } = await localClient
      .from("invoice_docs")
      .select("*")
      .order("number", { ascending: true });
    expect(data?.[0].logo).toBe(LOGO);
    expect(data?.[1].logo).toBe(OTHER);
  });

  it("leaves small strings alone", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", notes: "short" });
    expect(blobKeys()).toHaveLength(0);
    const { data } = await localClient.from("invoice_docs").select("*");
    expect(data?.[0].notes).toBe("short");
  });

  it("still reads rows written before the split existed", async () => {
    // Exactly what an existing install has on disk: the logo inline.
    localStorage.setItem(
      "localdb:invoice_docs",
      JSON.stringify([{ id: 1, number: "OLD-1", logo: LOGO }])
    );
    clearLocalCache();
    const { data } = await localClient.from("invoice_docs").select("*");
    expect(data?.[0].logo).toBe(LOGO);
  });

  it("gives sync the real value, never the marker", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", logo: LOGO });
    clearLocalCache();
    // sync.ts and migrate.ts both push what loadColl returns.
    const rows = await loadColl("invoice_docs");
    expect(rows[0].logo).toBe(LOGO);
    expect(JSON.stringify(rows)).not.toContain("__blob");
  });

  it("round-trips a cloud pull through replaceColl", async () => {
    expect(await replaceColl("invoice_docs", [{ id: 7, logo: LOGO }])).toBe(true);
    // Same rows again is genuinely unchanged — the comparison must not be
    // confused by markers on one side and payloads on the other.
    expect(await replaceColl("invoice_docs", [{ id: 7, logo: LOGO }])).toBe(false);

    clearLocalCache();
    const rows = await loadColl("invoice_docs");
    expect(rows[0].logo).toBe(LOGO);
  });

  // The dangerous case. loadColl turns any throw into an EMPTY collection, and
  // a blob that resolved to "" would be saved back as "" — losing the logo for
  // good over what may be a momentary read failure.
  it("keeps the rows and the logo when a blob read fails", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", logo: LOGO });
    clearLocalCache();

    const real = Storage.prototype.getItem;
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(function (this: Storage, k: string) {
        if (k.startsWith("localdb:blob:")) throw new Error("read failed");
        return real.call(this, k);
      });

    // The collection must survive — not come back empty.
    const { data } = await localClient.from("invoice_docs").select("*");
    expect(data).toHaveLength(1);
    expect(data?.[0].number).toBe("INV-1");
    expect(data?.[0].logo).not.toBe(""); // marker kept, not blanked

    // A save while the blob is unreadable must not destroy the reference.
    await localClient
      .from("invoice_docs")
      .update({ status: "paid" })
      .eq("number", "INV-1");

    spy.mockRestore();
    clearLocalCache();
    const { data: after } = await localClient.from("invoice_docs").select("*");
    expect(after?.[0].logo).toBe(LOGO);
    expect(after?.[0].status).toBe("paid");
  });

  it("survives an update that changes the logo", async () => {
    await localClient.from("invoice_docs").insert({ number: "INV-1", logo: LOGO });
    await localClient.from("invoice_docs").update({ logo: OTHER }).eq("number", "INV-1");
    clearLocalCache();
    const { data } = await localClient.from("invoice_docs").select("*");
    expect(data?.[0].logo).toBe(OTHER);
  });
});
