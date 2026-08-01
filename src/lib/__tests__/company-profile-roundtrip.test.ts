// @vitest-environment jsdom
// Guards the company-profile read path: getCompany used to re-map the row through
// a hand-written field whitelist, so columns added later (legal_id / legal_id_type
// / country_subdivision — the UAE trade-license fields) came back blank right after
// a successful save. Every saved column must survive the round-trip.
import { beforeAll, test, expect } from "vitest";

beforeAll(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

test("company profile round-trips the trade-license fields", async () => {
  const { billing } = await import("../api");
  await billing.saveCompany({
    name: "Acme Trading LLC",
    address: "Deira",
    legal_id: "CN-1234567",
    legal_id_type: "TL",
    country_subdivision: "DXB",
    default_accent: "#222222",
    default_template: "minimal",
  });
  const c = await billing.getCompany();
  expect(c.legal_id).toBe("CN-1234567");
  expect(c.legal_id_type).toBe("TL");
  expect(c.country_subdivision).toBe("DXB");
  expect(c.name).toBe("Acme Trading LLC");
  // Defaults still applied for columns the caller left out.
  expect(c.currency).toBe("AED");
  expect(c.default_tax_rate).toBe(5);
});
