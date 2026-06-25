// @vitest-environment jsdom
import { test, expect, beforeEach } from "vitest";
import { normalizeLocalEmirates } from "../migrate";

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

  // Idempotent: a second run touches nothing.
  expect(await normalizeLocalEmirates()).toBe(0);
});
