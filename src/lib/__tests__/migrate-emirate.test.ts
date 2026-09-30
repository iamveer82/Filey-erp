// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from "vitest";
import { normalizeLocalEmirates } from "../migrate";
import { journalSnapshot, loadColl } from "../localdb";

beforeEach(() => localStorage.clear());

test("normalizeLocalEmirates: remaps legacy AE-xx, leaves the rest, idempotent", async () => {
  localStorage.setItem(
    "localdb:crm_customers",
    JSON.stringify([
      { id: 1, country_subdivision: "AE-DU" }, // -> DXB
      { id: 2, country_subdivision: "SHJ" }, // already canonical
      { id: 3, country_subdivision: "" }, // empty untouched
    ])
  );
  localStorage.setItem(
    "localdb:invoice_docs",
    JSON.stringify([
      { id: 1, seller_country_subdivision: "AE-AZ", buyer_country_subdivision: "AE-FU" },
    ])
  );

  expect(await normalizeLocalEmirates()).toBe(3); // AE-DU + AE-AZ + AE-FU

  const cust = JSON.parse(localStorage.getItem("localdb:crm_customers")!);
  expect(cust.map((c: any) => c.country_subdivision)).toEqual(["DXB", "SHJ", ""]);
  const docs = JSON.parse(localStorage.getItem("localdb:invoice_docs")!);
  expect(docs[0].seller_country_subdivision).toBe("AUH");
  expect(docs[0].buyer_country_subdivision).toBe("FUJ");
  expect((await journalSnapshot()).tables).toMatchObject({
    crm_customers: { changed: [1] }, invoice_docs: { changed: [1] },
  });

  // Idempotent: a second run touches nothing.
  expect(await normalizeLocalEmirates()).toBe(0);
});

test("emirate repair rolls back all changes when any collection cannot be saved", async () => {
  localStorage.setItem("localdb:company_profile", '[{"id":1,"country_subdivision":"AE-DU"}]');
  localStorage.setItem("localdb:crm_customers", '[{"id":2,"country_subdivision":"AE-FU"}]');
  const before = await journalSnapshot();
  const write = Storage.prototype.setItem;
  let failed = false;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:crm_customers" && !failed) { failed = true; throw new Error("Disk full"); }
    return write.call(this, key, value);
  });
  try { await expect(normalizeLocalEmirates()).rejects.toThrow("Disk full"); }
  finally { spy.mockRestore(); }
  expect((await loadColl("company_profile"))[0].country_subdivision).toBe("AE-DU");
  expect((await loadColl("crm_customers"))[0].country_subdivision).toBe("AE-FU");
  expect(await journalSnapshot()).toEqual(before);
  expect(await normalizeLocalEmirates()).toBe(2);
});

test("does not claim damaged records already use current emirate codes", async () => {
  localStorage.setItem("localdb:company_profile", "damaged original");
  await expect(normalizeLocalEmirates()).rejects.toThrow("Could not read local company_profile");
  expect(localStorage.getItem("localdb:company_profile")).toBe("damaged original");
});
