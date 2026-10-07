import { beforeEach, expect, it, vi } from "vitest";
import { loadColl, replaceColl } from "../localdb";
import { pullIncremental, pullPaged } from "../sync";

type Row = { id: number; updated_at?: string; [key: string]: unknown };
function cloudRows(rows: Row[], failedId?: number) {
  const ranges = vi.fn(async (cols: string, from: number, to: number) => {
    if (cols === "*" && failedId !== undefined && rows.slice(from, to + 1).some(row => row.id === failedId))
      return { data: null, error: { message: "Synthetic download failure" } };
    const selected = rows.slice(from, to + 1);
    return { data: cols === "*" ? selected : selected.map(({ id, updated_at }) => ({ id, updated_at })), error: null };
  });
  const ids = vi.fn(async (_field: string, selected: number[]) => selected.includes(failedId!)
    ? { data: null, error: { message: "Synthetic download failure" } }
    : { data: rows.filter(row => selected.includes(row.id)), error: null });
  const client = { from: () => ({ select: (cols: string) => ({
    order: () => ({ range: (from: number, to: number) => ranges(cols, from, to) }),
    in: ids,
  }) }) };
  return { client: client as any, ranges, ids };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

it("downloads image-heavy invoice bodies one row per request while keeping metadata paged efficiently", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, updated_at: "new", logo: "synthetic image".repeat(15_000) }));
  const { client, ranges, ids } = cloudRows(rows);
  expect(await pullIncremental(client, "invoice_docs")).toEqual(rows);
  expect(ranges.mock.calls).toEqual([["id, updated_at", 0, 999]]);
  expect(ids.mock.calls.map(([, selected]) => selected)).toEqual([[1], [2], [3]]);
  ranges.mockClear();
  expect(await pullPaged(client, "invoice_docs", "*")).toEqual(rows);
  expect(ranges.mock.calls.every(([, from, to]) => from === to)).toBe(true);
});

it("keeps invoice metadata at 1000 rows per page without requesting full bodies", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, updated_at: "new" }));
  const { client, ranges, ids } = cloudRows(rows);
  expect(await pullPaged(client, "invoice_docs", "id, updated_at")).toEqual(rows);
  expect(ranges.mock.calls).toEqual([["id, updated_at", 0, 999], ["id, updated_at", 1000, 1999]]);
  expect(ids).not.toHaveBeenCalled();
});

it("reuses unchanged invoice bodies and omits rows deleted before or during the download", async () => {
  const cached = [{ id: 1, updated_at: "old", title: "old" }, { id: 2, updated_at: "same", title: "unchanged" }, { id: 3, updated_at: "old", title: "deleted remotely" }];
  await replaceColl("invoice_docs", cached);
  const fresh = { id: 1, updated_at: "new", title: "cloud edit" };
  const { client, ids } = cloudRows([fresh]);
  const metadata = [{ id: 1, updated_at: "new" }, { id: 2, updated_at: "same" }, { id: 4, updated_at: "new" }];
  expect(await pullIncremental(client, "invoice_docs", "updated_at", metadata)).toEqual([fresh, cached[1]]);
  expect(ids.mock.calls.map(([, selected]) => selected)).toEqual([[1], [4]]);
  expect(await loadColl("invoice_docs")).toEqual(cached);
});

it.each(["incremental", "paged"])("rejects a failed invoice %s download without returning or saving a partial collection", async kind => {
  const cached = [{ id: 9, updated_at: "old", title: "preserve device copy" }];
  await replaceColl("invoice_docs", cached);
  const rows = [{ id: 1, updated_at: "new" }, { id: 2, updated_at: "new" }];
  const { client, ranges, ids } = cloudRows(rows, 2);
  const download = kind === "incremental"
    ? pullIncremental(client, "invoice_docs", "updated_at", rows)
    : pullPaged(client, "invoice_docs", "*");
  await expect(download).rejects.toThrow("Synthetic download failure");
  expect(kind === "incremental" ? ids.mock.calls.length : ranges.mock.calls.length).toBe(2);
  expect(await loadColl("invoice_docs")).toEqual(cached);
});

it("retains normal product batches of 500 bodies and 1000 paged rows", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, updated_at: "new" }));
  const { client, ranges, ids } = cloudRows(rows);
  expect(await pullIncremental(client, "products", "updated_at", rows.slice(0, 501))).toEqual(rows.slice(0, 501));
  expect(ids.mock.calls.map(([, selected]) => selected.length)).toEqual([500, 1]);
  expect(await pullPaged(client, "products", "*")).toEqual(rows);
  expect(ranges.mock.calls).toEqual([["*", 0, 999], ["*", 1000, 1999]]);
});
