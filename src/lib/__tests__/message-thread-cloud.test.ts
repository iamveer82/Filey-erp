import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../supabase", () => {
  const from = () => {
    let channel = "", filter = "";
    const query = {
      select() { return query; },
      eq(_column: string, value: string) { channel = value; return query; },
      or(value: string) { filter = value; return query; },
      order() { return query; },
      then(resolve: (result: unknown) => unknown) { return mock.read(channel, filter).then(resolve); },
    };
    return query;
  };
  return { isConfigured: true, supabase: { from }, sb: () => ({ from }) };
});
import { messages, org, setCacheOrg, type OrgMessage } from "../api";
import { setDataMode } from "../dataMode";

const row = (id: number, parent_id: number | null, recipient_id: string | null = null): OrgMessage => ({
  id, parent_id, recipient_id, user_id: "me", body: `Message ${id}`, channel: "general", author: "", created_at: "2026-09-30T08:00:00Z",
});
beforeEach(() => {
  localStorage.clear();
  setDataMode("cloud");
  setCacheOrg("org", "alice");
  mock.read.mockReset();
  vi.spyOn(org, "members").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

it("resolves a cloud reply notification to its root and siblings", async () => {
  mock.read.mockResolvedValueOnce({ data: [row(12, 4)], error: null })
    .mockResolvedValueOnce({ data: [row(4, null), row(12, 4), row(13, 4)], error: null });
  expect((await messages.thread("general", 12)).map(m => m.id)).toEqual([4, 12, 13]);
  expect(mock.read.mock.calls).toEqual([
    ["general", "id.eq.12,parent_id.eq.12"],
    ["general", "id.eq.4,parent_id.eq.4"],
  ]);
});

it("loads an ordinary root in one query and does not follow an absent target", async () => {
  mock.read.mockResolvedValueOnce({ data: [row(4, null), row(12, 4)], error: null });
  expect((await messages.thread("general", 4)).map(m => m.id)).toEqual([4, 12]);
  expect(mock.read).toHaveBeenCalledOnce();
  mock.read.mockClear().mockResolvedValue({ data: [], error: null });
  expect(await messages.thread("sales", 12)).toEqual([]);
  expect(mock.read).toHaveBeenCalledOnce();
});

it("keeps direct-message recipient boundaries before following a reply", async () => {
  mock.read.mockResolvedValue({ data: [row(12, 4, "someone-else")], error: null });
  expect(await messages.thread("general", 12, "teammate")).toEqual([]);
  expect(mock.read).toHaveBeenCalledOnce();
});

it("preserves direct-message scope and reports a failed parent read", async () => {
  mock.read.mockResolvedValueOnce({ data: [row(12, 4, "teammate")], error: null })
    .mockResolvedValueOnce({ data: [row(4, null, "teammate"), row(12, 4, "teammate"), row(5, null)], error: null });
  expect((await messages.thread("general", 12, "teammate")).map(m => m.id)).toEqual([4, 12]);
  mock.read.mockResolvedValueOnce({ data: [row(12, 4)], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error("Thread unavailable") });
  await expect(messages.thread("general", 12)).rejects.toThrow("Thread unavailable");
});

it("rejects a late reply read when the workspace changes without following its parent", async () => {
  let release!: (result: unknown) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const loading = messages.thread("general", 12);
  const rejection = expect(loading).rejects.toThrow("workspace changed");
  await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
  setCacheOrg("another-org", "bob");
  release({ data: [row(12, 4)], error: null });
  await rejection;
  expect(mock.read).toHaveBeenCalledOnce();
});
