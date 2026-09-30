import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ error: null as Error | null, rows: [] as unknown[] }));
vi.mock("../moduleAccess", () => ({ loadModuleAccess: async () => ({ admin: true, modules: null }) }));
vi.mock("../supabase", () => {
  const from = () => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "range"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.error ? null : state.rows, error: state.error }).then(resolve);
    return query;
  };
  return { isConfigured: true, supabase: { from }, sb: () => ({ from }) };
});
import { advances, pos, setCacheOrg } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  state.error = null;
  state.rows = [];
  setCacheOrg("test-org", "test-user");
});

const readers = [
  { name: "customer advances", read: () => advances.forParty("customer", 1) },
  { name: "supplier advances", read: () => advances.forParty("supplier", 1) },
  { name: "all advances", read: () => advances.list() },
  { name: "purchase-order payments", read: () => pos.payments(1) },
];

it.each(readers)("does not report or cache an empty $name ledger after a failed first load", async ({ read }) => {
  state.error = new Error("Ledger unavailable");
  await expect(read()).rejects.toThrow("Ledger unavailable");
  state.error = null;
  state.rows = [{ id: 7, party_type: "customer", party_id: 1, po_id: 1, amount: "25.5", paid_at: "2026-09-30" }];
  expect(await read()).toMatchObject([{ id: 7 }]);
});

it.each(readers)("returns an empty $name ledger when the server confirms no rows", async ({ read }) => {
  expect(await read()).toEqual([]);
});
