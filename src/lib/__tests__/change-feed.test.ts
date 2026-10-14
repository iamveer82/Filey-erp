import { beforeEach, expect, it, vi } from "vitest";
import { journalMark, loadColl, localClient, replaceColl } from "../localdb";
import { pullChanges, readPosition, reconcile, savePosition } from "../changeFeed";

const feed = vi.hoisted(() => ({
  answer: null as unknown,
  error: null as { code?: string; message: string } | null,
  fetched: [] as string[][],
  cloud: new Map<string, Record<string, unknown>>(),
  duringFetch: null as null | (() => Promise<void>),
}));
const client = {
  rpc: async (name: string) => name === "filey_sync_cursor"
    ? { data: { cursor: "500", org: "org-1" }, error: null }
    : { data: feed.error ? null : feed.answer, error: feed.error },
  from: () => ({
    select: () => ({
      in: async (_column: string, ids: string[]) => {
        feed.fetched.push(ids);
        await feed.duringFetch?.();
        return { data: ids.flatMap(id => feed.cloud.has(id) ? [feed.cloud.get(id)!] : []), error: null };
      },
    }),
  }),
} as never;
const answer = (changes: unknown[], extra: Record<string, unknown> = {}) => ({ cursor: "200", org: "org-1", changes, ...extra });
const ids = async () => (await loadColl("products")).map(r => [r.id, r.name, r.sync_revision]);

beforeEach(async () => {
  localStorage.clear();
  feed.error = null;
  feed.fetched = [];
  feed.duringFetch = null;
  feed.cloud = new Map([
    ["2", { id: 2, name: "Edited on phone", sync_revision: 2 }],
    ["3", { id: 3, name: "Made on phone", sync_revision: 1 }],
  ]);
  await replaceColl("products", [{ id: 1, name: "Uploaded from here", sync_revision: 1 }, { id: 2, name: "Old", sync_revision: 1 }]);
  await savePosition("owner", { cursor: "100", org: "org-1" });
});

it("downloads only rows it does not already hold at that revision", async () => {
  feed.answer = answer([
    { t: "products", id: "1", op: "u", rev: 1 }, // this device's own upload coming back
    { t: "products", id: "2", op: "u", rev: 2 },
    { t: "products", id: "3", op: "u", rev: 1 },
    { t: "products", id: "9", op: "d" }, // never held here
  ]);
  expect(await pullChanges(client, "owner", { keepUnsent: true })).toEqual({ status: "applied", tables: ["products"] });
  expect(feed.fetched).toEqual([["2", "3"]]);
  expect(await ids()).toEqual([[1, "Uploaded from here", 1], [2, "Edited on phone", 2], [3, "Made on phone", 1]]);
  expect(await readPosition("owner")).toEqual({ cursor: "200", org: "org-1" });

  feed.fetched = [];
  feed.answer = answer([{ t: "products", id: "1", op: "d" }], { cursor: "300" });
  await pullChanges(client, "owner", { keepUnsent: true });
  expect(feed.fetched).toEqual([]);
  expect((await ids()).map(([id]) => id)).toEqual([2, 3]);
});

it("leaves rows edited here and not yet uploaded for the upload to settle", async () => {
  await journalMark("products", { changed: [2] });
  feed.answer = answer([{ t: "products", id: "2", op: "u", rev: 2 }, { t: "products", id: "3", op: "u", rev: 1 }]);
  await pullChanges(client, "owner", { keepUnsent: true });
  expect(feed.fetched).toEqual([["3"]]);
  expect(await ids()).toEqual([[1, "Uploaded from here", 1], [2, "Old", 1], [3, "Made on phone", 1]]);
});

it("asks for one complete copy when the position is missing, foreign or too old", async () => {
  feed.answer = answer([], { org: "another-workspace" });
  expect(await pullChanges(client, "owner", { keepUnsent: true })).toEqual({ status: "reconcile" });
  feed.answer = answer([], { stale: true });
  expect(await pullChanges(client, "owner", { keepUnsent: true })).toEqual({ status: "reconcile" });
  feed.error = { code: "PGRST202", message: "Could not find the function public.filey_sync_changes" };
  expect(await pullChanges(client, "owner", { keepUnsent: true })).toEqual({ status: "reconcile" });
  expect(await pullChanges(client, "someone-new", { keepUnsent: true })).toEqual({ status: "reconcile" });
  expect(await readPosition("owner")).toEqual({ cursor: "100", org: "org-1" });

  // The complete copy resumes from the position taken before it, not after.
  expect(await reconcile(client, "someone-new", async () => true)).toBe(true);
  expect(await readPosition("someone-new")).toEqual({ cursor: "500", org: "org-1" });
  expect(await reconcile(client, "unlucky", async () => false)).toBe(false);
  expect(await readPosition("unlucky")).toBeNull();
});

it("keeps its position when a save lands during the download, so nothing is skipped", async () => {
  feed.answer = answer([{ t: "products", id: "3", op: "u", rev: 1 }]);
  feed.duringFetch = async () => { await localClient.from("products").insert({ id: 50, name: "Typed meanwhile" }); };
  expect(await pullChanges(client, "owner", { keepUnsent: true })).toEqual({ status: "busy" });
  expect(await readPosition("owner")).toEqual({ cursor: "100", org: "org-1" });
  expect((await ids()).map(([id]) => id)).toContain(50);
});
