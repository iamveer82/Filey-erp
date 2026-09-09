import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({
  fail: false,
  wait: Promise.resolve(),
}));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  const { isLocalMode } = await import("../dataMode");
  return {
    isConfigured: true,
    supabase: null,
    sb: () => ({
      from: (table: string) => {
        if (isLocalMode()) return localClient.from(table);
        const query = {
          update: () => query,
          delete: () => query,
          eq: () => query,
          in: () => query,
          select: () => query,
          single: () => query,
          then: (resolve: (value: unknown) => unknown) => cloud.wait.then(() =>
            resolve({ data: cloud.fail ? null : { id: 1 }, error: cloud.fail ? { message: "Save failed" } : null })
          ),
        };
        return query;
      },
    }),
  };
});

import { erp } from "../api";
import { setDataMode } from "../dataMode";
import { localClient } from "../localdb";
import { notifyDataChanged, useLiveSync } from "../realtime";

beforeEach(() => {
  localStorage.clear();
  setDataMode("cloud");
  cloud.fail = false;
  cloud.wait = Promise.resolve();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const refresh = () => act(() => vi.advanceTimersByTime(250));

it("coalesces local, sync and cloud changes, uses the latest callback and cleans up", () => {
  const previous = vi.fn();
  const latest = vi.fn();
  const hook = renderHook(({ reload }) => useLiveSync(reload), {
    initialProps: { reload: previous },
  });
  window.dispatchEvent(new Event("filey:local-write"));
  window.dispatchEvent(new Event("filey:remote-update"));
  notifyDataChanged();
  hook.rerender({ reload: latest });
  refresh();
  expect(previous).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);

  // A workspace switch requires the existing explicit reload flow.
  window.dispatchEvent(new Event("filey:workspace-changed"));
  refresh();
  expect(latest).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("filey:local-write"));
  hook.unmount();
  window.dispatchEvent(new Event("filey:remote-update"));
  notifyDataChanged();
  refresh();
  expect(latest).toHaveBeenCalledTimes(1);
});

it("refreshes mounted charts only after a cloud save is acknowledged", async () => {
  const reload = vi.fn();
  renderHook(() => useLiveSync(reload));
  let release!: () => void;
  cloud.wait = new Promise<void>((resolve) => { release = resolve; });
  const saving = erp.updateProduct(1, { name: "Changed" });
  refresh();
  expect(reload).not.toHaveBeenCalled();
  release();
  await saving;
  refresh();
  expect(reload).toHaveBeenCalledTimes(1);
});

it("refreshes once after a bulk cloud save, but not failed or offline writes", async () => {
  const reload = vi.fn();
  renderHook(() => useLiveSync(reload));
  await erp.deleteProducts([1, 2]);
  refresh();
  expect(reload).toHaveBeenCalledTimes(1);
  cloud.fail = true;
  await expect(erp.updateProduct(1, { name: "Rejected" })).rejects.toMatchObject({ message: "Save failed" });
  await expect(erp.deleteProducts([1, 2])).rejects.toMatchObject({ message: "Save failed" });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(erp.updateProduct(1, { name: "Offline" })).rejects.toThrow("will not be saved");
  refresh();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("outbox")).toBeNull();
});

it("refreshes after real local database mutations, including writes outside the API wrappers", async () => {
  setDataMode("local");
  const reload = vi.fn();
  renderHook(() => useLiveSync(reload));
  await localClient.from("products").insert({ id: 1, name: "Original" });
  await erp.updateProduct(1, { name: "Changed" });
  refresh();
  expect(reload).toHaveBeenCalledTimes(1);
  expect((await erp.products())[0].name).toBe("Changed");
  await localClient.from("products").delete().eq("id", 1);
  refresh();
  expect(reload).toHaveBeenCalledTimes(2);
});
