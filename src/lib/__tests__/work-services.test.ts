import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getCountryMarketData, getPublicHolidays, listHolidayCountries, searchCreativeAssets, WORK_SERVICES } from "../workServices";

const fetchMock = vi.fn();
const json = (value: unknown) => new Response(JSON.stringify(value));
const country = { isoCode: "DE", name: [{ language: "EN", text: "Germany" }] };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("lists explicit access and cost limits without provider credentials", () => {
  expect(new Set(WORK_SERVICES.map(service => service.id)).size).toBe(WORK_SERVICES.length);
  expect(WORK_SERVICES.filter(service => service.tool).map(service => service.tool).sort()).toEqual(["assets", "holidays", "market"]);
  for (const service of WORK_SERVICES) {
    expect(service.limits.length).toBeGreaterThan(20);
    expect(new URL(service.docsUrl, "https://gofiley.com").protocol).toBe("https:");
    expect(service).not.toHaveProperty("apiKey");
  }
});

it("keeps observation years and sources on country market data without writing records", async () => {
  const writes = vi.spyOn(Storage.prototype, "setItem");
  fetchMock.mockImplementation(async (url: string) => json([{ lastupdated: "2026-07-13" }, [{ country: { id: "AE", value: "United Arab Emirates" }, date: url.includes("SP.POP") ? "2025" : "2024", value: url.includes("SP.POP") ? 10_000_000 : 500_000_000_000 }]]));
  const result = await getCountryMarketData(" ae ");
  expect(result.countryName).toBe("United Arab Emirates");
  expect(result.rows.map(row => [row.value, row.year])).toEqual([[500_000_000_000, "2024"], [10_000_000, "2025"]]);
  expect(result.rows[0].sourceUrl).toContain("NY.GDP.MKTP.CD?locations=AE");
  expect(result.attribution).toContain("CC BY 4.0");
  expect(writes).not.toHaveBeenCalled();
  for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ credentials: "omit", method: "GET" });
});

it("represents a missing market observation as unavailable instead of zero", async () => {
  fetchMock.mockResolvedValueOnce(json([{}, []])).mockResolvedValueOnce(json([{}, [{ country: { id: "IN", value: "India" }, date: "2025", value: 100 }]]));
  const result = await getCountryMarketData("IN");
  expect(result.rows[0]).toMatchObject({ value: null, year: null });
  fetchMock.mockImplementation(async () => json([{ message: [{ key: "Invalid value" }] }]));
  await expect(getCountryMarketData("ZZ")).rejects.toThrow("invalid country response");
});

it("rejects invalid or unsupported requests before making an inappropriate API call", async () => {
  await expect(getCountryMarketData("AE/../../all")).rejects.toThrow("two-letter");
  await expect(getPublicHolidays("DE", NaN)).rejects.toThrow("year");
  await expect(searchCreativeAssets("a")).rejects.toThrow("2 and 160");
  await expect(searchCreativeAssets("office", { limit: 1000 })).rejects.toThrow("1 and 10");
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(json([country]));
  await expect(getPublicHolidays("AE", 2026)).rejects.toThrow("does not currently cover AE");
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("retains regional holiday scope and excludes invalid calendar dates", async () => {
  fetchMock.mockResolvedValueOnce(json([country])).mockResolvedValueOnce(json([
    { id: "1", name: [{ language: "EN", text: "Regional holiday" }], startDate: "2026-01-06", endDate: "2026-01-06", nationwide: false, subdivisions: [{ code: "DE-BY" }] },
    { id: "2", name: [{ language: "EN", text: "Invalid date" }], startDate: "2026-02-31", endDate: "2026-02-31", nationwide: true },
  ]));
  const result = await getPublicHolidays("de", 2026);
  expect(result.rows).toEqual([{ id: "1", name: "Regional holiday", startDate: "2026-01-06", endDate: "2026-01-06", nationwide: false, subdivisions: ["DE-BY"] }]);
  expect(result.attribution).toContain("ODbL");
  fetchMock.mockResolvedValueOnce(json({ wrong: true }));
  await expect(listHolidayCountries()).rejects.toThrow("invalid country list");
});

const asset = (id: number, license: string, licenseUrl: string, extra: Record<string, unknown> = {}) => ({
  pageid: id, title: `File:Office ${id}.jpg`, imageinfo: [{ mime: "image/jpeg", url: "https://upload.wikimedia.org/wikipedia/commons/example.jpg", thumburl: "https://thumb.wikimedia.org/wikipedia/commons/example.jpg", descriptionurl: `https://commons.wikimedia.org/wiki/File:Office_${id}.jpg`, extmetadata: { LicenseShortName: { value: license }, LicenseUrl: { value: licenseUrl }, Artist: { value: '<a href="javascript:alert(1)">Photographer</a><img src="https://invalid.example/pixel" onerror="alert(1)">' } }, ...extra }],
});

it("returns reusable images with plain-text credits while excluding unknown licences and hostile URLs", async () => {
  fetchMock.mockResolvedValue(json({ query: { pages: [
    asset(1, "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0"),
    asset(2, "Public domain", ""),
    asset(3, "CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0/"),
    asset(4, "Unknown", ""),
    asset(5, "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", { thumburl: "https://attacker.example/image.jpg" }),
    asset(6, "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", { descriptionurl: "javascript:alert(1)" }),
  ] } }));
  const result = await searchCreativeAssets("office", { limit: 6 });
  expect(result.rows.map(row => row.id)).toEqual(["1", "2"]);
  expect(result.rows[0]).toMatchObject({ creator: "Photographer", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" });
  expect(JSON.stringify(result.rows)).not.toMatch(/javascript:|onerror|<a|<img/);
  expect(result.rows[1].licenseUrl).toBe(result.rows[1].sourceUrl);
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(url).searchParams.get("gsrlimit")).toBe("6");
  expect(init.headers["Api-User-Agent"]).toContain("gofiley.com");
});

it("reports provider rate limits and malformed results without exposing response bodies", async () => {
  fetchMock.mockResolvedValueOnce(new Response("private provider diagnostics", { status: 429 }));
  await expect(searchCreativeAssets("office")).rejects.toThrow("request limit");
  fetchMock.mockResolvedValueOnce(new Response("<html>Unavailable</html>"));
  await expect(searchCreativeAssets("office")).rejects.toThrow("invalid response");
  fetchMock.mockResolvedValueOnce(json({ error: { info: "Do something unsafe" } }));
  await expect(searchCreativeAssets("office")).rejects.toThrow("could not complete");
});

it("honours cancellation and times out stalled public requests", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const controller = new AbortController();
  const cancelled = expect(searchCreativeAssets("office", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelled;
  const stalled = expect(searchCreativeAssets("office")).rejects.toThrow("too long");
  await vi.advanceTimersByTimeAsync(12_000);
  await stalled;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
