import { beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ error: null as Error | null, changed: vi.fn(), setting: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: mock.changed }));
vi.mock("../supabase", () => {
  const from = () => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "order", "limit"]) query[method] = () => query;
    query.maybeSingle = mock.setting;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: mock.error }).then(resolve);
    return query;
  };
  return { isConfigured: true, supabase: { from }, sb: () => ({ from }) };
});
import { billing, notifs, recurrences, tools, setCacheOrg } from "../api";

beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  mock.changed.mockClear(); mock.error = null;
  mock.setting.mockReset().mockImplementation(() => Promise.resolve({ data: null, error: mock.error }));
  setCacheOrg("org", "alice");
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

it("does not replace a setting when its existing value could not be read", async () => {
  mock.error = new Error("Settings read failed");
  await expect(tools.setSetting("email_templates", "[]")).rejects.toThrow("Settings read failed");
  expect(mock.changed).not.toHaveBeenCalled();
});

it("cannot save the previous workspace's setting after a pending lookup", async () => {
  let release!: (result: unknown) => void;
  mock.setting.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const saving = tools.setSetting("email_templates", "previous workspace draft");
  const rejection = expect(saving).rejects.toThrow("workspace changed");
  await waitFor(() => expect(mock.setting).toHaveBeenCalledOnce());
  setCacheOrg("another-org", "bob");
  release({ data: null, error: null });
  await rejection;
  expect(mock.changed).not.toHaveBeenCalled();
});
