import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accessFrom, TRIAL_ENDED_MESSAGE } from "../license";
import { localClient, setLocalWriteLock } from "../localdb";
import { setCacheOrg } from "../api";

// Basic is a 14-day trial; afterwards the app stays readable (view, print, export) and
// creating or editing waits for Freedom or Pro.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("test-org", "test-user");
});
afterEach(() => setLocalWriteLock(null));

it("resolves Pro, Freedom, days left, an ended trial and unknown", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  expect(accessFrom("pro", null, now)).toEqual({ plan: "pro" });
  expect(accessFrom("lite", new Date("2026-01-01"), now)).toEqual({ plan: "freedom" });
  expect(accessFrom("free", new Date("2026-10-21T00:00:00Z"), now)).toEqual({ plan: "trial", daysLeft: 4 });
  expect(accessFrom("free", new Date("2026-10-17T12:00:01Z"), now)).toEqual({ plan: "trial", daysLeft: 1 });
  expect(accessFrom("free", new Date("2026-10-17T11:00:00Z"), now)).toEqual({ plan: "ended" });
  expect(accessFrom("free", null, now)).toEqual({ plan: "unknown" });
});

it("after the trial reads everything, keeps preferences, refuses new records and offers Freedom", async () => {
  const db = localClient;
  await db.from("customers").insert({ id: 1, name: "Rennox" });
  const offered = vi.fn();
  window.addEventListener("filey:upgrade", offered);
  setLocalWriteLock(TRIAL_ENDED_MESSAGE);

  const refused = await db.from("customers").insert({ id: 2, name: "Bapco" });
  expect(refused.error?.message).toBe(TRIAL_ENDED_MESSAGE);
  expect(offered).toHaveBeenCalledTimes(1);
  expect((await db.from("customers").update({ name: "Changed" }).eq("id", 1)).error?.message).toBe(TRIAL_ENDED_MESSAGE);
  expect((await db.from("customers").select("*")).data).toEqual([expect.objectContaining({ id: 1, name: "Rennox" })]);
  expect((await db.from("app_settings").upsert({ key: "theme", value: "dark" })).error).toBeNull();

  setLocalWriteLock(null);
  expect((await db.from("customers").insert({ id: 2, name: "Bapco" })).error).toBeNull();
  window.removeEventListener("filey:upgrade", offered);
});

it("refuses cloud table writes after the trial, keeps cloud reads and settings", async () => {
  const { lockedCloud } = await import("../supabase");
  const builder = (table: string) => ({
    select: () => Promise.resolve({ data: [{ table }], error: null }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 9 }, error: null }) }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
  });
  const cloud = lockedCloud({ from: builder } as never);
  setLocalWriteLock(TRIAL_ENDED_MESSAGE);
  const refused = await cloud.from("invoices").insert({ number: "INV-1" }).select().single();
  expect(refused).toEqual({ data: null, error: { message: TRIAL_ENDED_MESSAGE, code: "FILEY_PLAN" } });
  expect(await cloud.from("invoices").select("*")).toEqual({ data: [{ table: "invoices" }], error: null });
  expect((await cloud.from("app_settings").upsert({ key: "theme" })).error).toBeNull();
  setLocalWriteLock(null);
  expect((await cloud.from("invoices").insert({}).select().single()).data).toEqual({ id: 9 });
});
