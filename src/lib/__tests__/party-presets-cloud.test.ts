import { beforeEach, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: vi.fn() }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../supabase", () => ({
  isConfigured: true, supabase: null,
  sb: () => ({ from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const query = {
      select: () => query, order: () => query, range: () => query, eq: () => query, single: () => query,
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        if (patch) {
          // Match JSON transport: undefined keys cannot erase a stored value.
          const payload = JSON.parse(JSON.stringify(patch));
          cloud.writes(table, payload);
          cloud.rows.set(table, { ...cloud.rows.get(table), ...payload });
        }
        return Promise.resolve({ data: patch ? { id: 17 } : [cloud.rows.get(table)], error: null }).then(resolve);
      },
    };
    return query;
  } }),
}));

import { crm, setCacheOrg, suppliers } from "../api";

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("fixture-org", "fixture-owner");
  cloud.rows.clear(); cloud.writes.mockClear();
});

it("round trips party identity presets and explicit clears through cloud JSON updates", async () => {
  const identity = { corporate_trn: "100123456700003", tin: "1001234567", endpoint_id: "1001234567",
    endpoint_scheme: "0235", legal_id: "LIC-17", legal_id_type: "TL", legal_authority: "Dubai", identifier: "BUYER-17" };
  const custom_fields = { unrelated: "Preserved metadata", einvoice_identity: JSON.stringify(identity) };
  const bank_details = { iban: "Preserved bank" };
  cloud.rows.set("crm_customers", { id: 17, name: "Customer", company: "Company", trn: "100123456700003",
    email: "old@example.test", phone: "+971501234567", phone_e164: "+971501234567", address: "Old address", bank_details });
  cloud.rows.set("suppliers", { id: 17, name: "Supplier", contact_person: "Contact", tax_id: "100123456700003",
    email: "old@example.test", phone: "+971501234567", address: "Old address", bank_details });
  await crm.updateCustomer(17, { custom_fields });
  await suppliers.update(17, { custom_fields });
  expect((await crm.customers())[0]).toMatchObject({ custom_fields, bank_details, trn: "100123456700003" });
  expect((await suppliers.list())[0]).toMatchObject({ custom_fields, bank_details, tax_id: "100123456700003" });
  const clearedCustomer = { company: "", trn: "", email: "", phone: "", phone_e164: "", address: "" };
  const clearedSupplier = { contact_person: "", tax_id: "", email: "", phone: "", address: "" };
  await crm.updateCustomer(17, clearedCustomer);
  await suppliers.update(17, clearedSupplier);
  expect(cloud.writes).toHaveBeenCalledWith("crm_customers", clearedCustomer);
  expect(cloud.writes).toHaveBeenCalledWith("suppliers", clearedSupplier);
  expect((await crm.customers())[0]).toMatchObject({ ...clearedCustomer, custom_fields, bank_details });
  expect((await suppliers.list())[0]).toMatchObject({ ...clearedSupplier, custom_fields, bank_details });
});
