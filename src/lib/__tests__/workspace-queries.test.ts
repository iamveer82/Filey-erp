import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ scope: "org:user:alice", mode: "cloud", read: vi.fn() }));
vi.mock("../api", () => ({
  getCacheScope: () => fixtures.scope,
  erp: { products: fixtures.read, orders: fixtures.read },
  billing: { listDocs: fixtures.read }, crm: { customers: fixtures.read },
}));
vi.mock("../dataMode", () => ({ getDataMode: () => fixtures.mode, assertWorkspaceCurrent: () => {} }));
import { createWorkspaceStore, workspaceQueries, workspaceQueryScope } from "../workspaceQueries";

beforeEach(() => { fixtures.scope = "org:user:alice"; fixtures.mode = "cloud"; fixtures.read.mockReset().mockResolvedValue([]); });

it("two consumers share the same four queries and invalidation refreshes the snapshot", async () => {
  const store = createWorkspaceStore();
  const arg = { scope: workspaceQueryScope(), modules: ["inventory", "orders", "invoicing", "customers"] };
  const a = store.dispatch(workspaceQueries.endpoints.dataset.initiate(arg));
  const b = store.dispatch(workspaceQueries.endpoints.dataset.initiate(arg));
  await Promise.all([a.unwrap(), b.unwrap()]);
  expect(fixtures.read).toHaveBeenCalledTimes(4);
  store.dispatch(workspaceQueries.util.invalidateTags(["Workspace"]));
  await vi.waitFor(() => expect(fixtures.read).toHaveBeenCalledTimes(8));
  a.unsubscribe(); b.unsubscribe(); store.dispatch(workspaceQueries.util.resetApiState());
});

it("queries only permitted modules and does not retain results from a changed workspace", async () => {
  const store = createWorkspaceStore();
  const arg = { scope: workspaceQueryScope(), modules: ["inventory"] };
  let release!: (value: unknown[]) => void;
  fixtures.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = store.dispatch(workspaceQueries.endpoints.dataset.initiate(arg));
  fixtures.scope = "org:user:bob";
  release([{ id: 1, name: "Alice private product" }]);
  await expect(old.unwrap()).rejects.toMatchObject({ message: "Workspace records could not be refreshed." });
  expect(workspaceQueries.endpoints.dataset.select(arg)(store.getState()).data).toBeUndefined();
  const current = store.dispatch(workspaceQueries.endpoints.dataset.initiate({ ...arg, scope: workspaceQueryScope() }));
  expect(await current.unwrap()).toEqual({ products: [], orders: [], invoices: [], customers: [] });
  expect(fixtures.read).toHaveBeenCalledTimes(2);
  old.unsubscribe(); current.unsubscribe(); store.dispatch(workspaceQueries.util.resetApiState());
});
