import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ error: null as Error | null, changed: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: mock.changed }));
vi.mock("../supabase", () => {
  const from = () => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "order", "limit"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: mock.error }).then(resolve);
    return query;
  };
  return { isConfigured: true, supabase: { from }, sb: () => ({ from }) };
});
import { billing, notifs, recurrences, tools } from "../api";

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  mock.changed.mockClear(); mock.error = null;
});

it("notifies mounted pages only after an acknowledged multi-step cloud mutation", async () => {
  await notifs.markRead(1);
  expect(mock.changed).toHaveBeenCalledTimes(1);
  mock.changed.mockClear(); mock.error = new Error("No permission");
  await expect(notifs.markRead(2)).rejects.toThrow("No permission");
  expect(mock.changed).not.toHaveBeenCalled();
});

it("read-only operations do not create a live-refresh loop", async () => {
  await notifs.list(); await recurrences.list(); await billing.payments(1); await tools.auditLog();
  expect(mock.changed).not.toHaveBeenCalled();
});
