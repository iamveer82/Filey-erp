import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanyAssetImage } from "../../components/CompanyAssetImage";
import { companyAssetUrl } from "../files";
import { elementToPdfBytes } from "../pdfTools";
import { reactToPdfBytes } from "../reactPdf";

vi.mock("../files", () => ({ companyAssetUrl: vi.fn() }));
vi.mock("../pdfTools", () => ({ elementToPdfBytes: vi.fn(async (_host: HTMLElement, name: string) => ({ name: `${name}.pdf`, bytes: new Uint8Array([1]) })) }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => { vi.restoreAllMocks(); });

it("waits for a delayed private asset URL and its image load before offscreen PDF capture", async () => {
  let resolveUrl!: (url: string) => void;
  vi.mocked(companyAssetUrl).mockReturnValueOnce(new Promise((resolve) => { resolveUrl = resolve; }));
  const result = reactToPdfBytes(<CompanyAssetImage src="owner/company/delayed/stamp.png" alt="Stamp" className="block" />, "packing-list");
  await waitFor(() => expect(companyAssetUrl).toHaveBeenCalledOnce());
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(elementToPdfBytes).not.toHaveBeenCalled();
  const image = document.querySelector<HTMLImageElement>('[data-company-asset-status]')!;
  expect(image).toHaveAttribute("data-company-asset-status", "loading");
  expect(image).not.toBeVisible();
  resolveUrl("https://assets.example.test/stamp.png");
  await waitFor(() => expect(image).toHaveAttribute("src", "https://assets.example.test/stamp.png"));
  expect(elementToPdfBytes).not.toHaveBeenCalled();
  Object.defineProperty(image, "complete", { configurable: true, value: true });
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 120 });
  fireEvent.load(image);
  await expect(result).resolves.toEqual({ name: "packing-list.pdf", bytes: new Uint8Array([1]) });
  expect(elementToPdfBytes).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-company-asset-status]')).toBeNull();
});

it.each(["missing", "rejected"] as const)("rejects a %s initial asset resolution instead of exporting without it", async (failure) => {
  if (failure === "missing") vi.mocked(companyAssetUrl).mockResolvedValueOnce(null);
  else vi.mocked(companyAssetUrl).mockRejectedValueOnce(new Error("Signing failed"));
  await expect(reactToPdfBytes(<CompanyAssetImage src={`owner/company/${failure}/stamp.png`} alt="Stamp" />, "packing-list")).rejects.toThrow("The Stamp could not be loaded.");
  expect(elementToPdfBytes).not.toHaveBeenCalled();
  expect(document.querySelector('[data-company-asset-status]')).toBeNull();
});

it.each(["missing", "rejected"] as const)("rejects a %s retry after an expired asset image fails", async (failure) => {
  vi.mocked(companyAssetUrl).mockResolvedValueOnce(`https://assets.example.test/expired-${failure}.png`);
  if (failure === "missing") vi.mocked(companyAssetUrl).mockResolvedValueOnce(null);
  else vi.mocked(companyAssetUrl).mockRejectedValueOnce(new Error("Re-signing failed"));
  const result = expect(reactToPdfBytes(<CompanyAssetImage src={`owner/company/retry-${failure}/stamp.png`} alt="Stamp" />, "packing-list")).rejects.toThrow("The Stamp could not be loaded.");
  await waitFor(() => expect(document.querySelector("img")).toHaveAttribute("src", `https://assets.example.test/expired-${failure}.png`));
  fireEvent.error(document.querySelector("img")!);
  await result;
  expect(companyAssetUrl).toHaveBeenCalledTimes(2);
  expect(elementToPdfBytes).not.toHaveBeenCalled();
});
