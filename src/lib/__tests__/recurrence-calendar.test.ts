import { afterEach, expect, it, vi } from "vitest";
const generated = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../recurrenceGeneration", () => ({ generateRecurringInvoice: generated }));
import { recurrences, setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { clearLocalCache, localClient } from "../localdb";
import { todayYmd } from "../format";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses the RPC's UTC cycle date when the Dubai browser calendar has already advanced", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T21:00:00Z"));
  vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
  vi.spyOn(Date.prototype, "getMonth").mockReturnValue(9);
  vi.spyOn(Date.prototype, "getDate").mockReturnValue(4);
  expect(todayYmd()).toBe("2026-10-04");
  localStorage.clear(); clearLocalCache(); setDataMode("local"); setCacheOrg("calendar-org", "calendar-user");
  await localClient.from("invoice_recurrence").insert({ id: 1, active: true, base_invoice_id: 1, next_run: "2026-10-03", interval: "monthly" });
  expect(await recurrences.generateDue()).toBe(1);
  expect(generated).toHaveBeenCalledWith(1, "2026-10-03", "2026-10-03", "2026-11-03");
});
