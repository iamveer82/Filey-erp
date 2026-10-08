import { afterEach, expect, it, vi } from "vitest";
import { internationalPhone, messageUrl, publicAppBase, invoicePublicLink, quotationPublicLink, purchaseOrderPublicLink, receiptPublicLink } from "../documentMessage";
import { billing, quotes, pos, receipts } from "../api";
import { isLocalMode } from "../dataMode";

vi.mock("../api", () => ({
  billing: { publicLink: vi.fn(async () => "token/123") },
  quotes: { publicLink: vi.fn(async () => "token/123") },
  pos: { publicLink: vi.fn(async () => "token/123") },
  receipts: { publicLink: vi.fn(async () => "token/123") },
}));
vi.mock("../dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataMode")>()),
  isLocalMode: vi.fn(() => false),
}));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.mocked(isLocalMode).mockReturnValue(false); });

it("validates international recipients and safely encodes message drafts", () => {
  expect(internationalPhone("00971 (50) 123-4567")).toBe("+971501234567");
  for (const bad of ["", "0501234567", "+971abc12345", "+012345678", "+1234567890123456"])
    expect(() => internationalPhone(bad)).toThrow("country code");
  expect(messageUrl("whatsapp", "+971501234567", "Invoice #1\nA & B"))
    .toBe("https://wa.me/971501234567?text=Invoice%20%231%0AA%20%26%20B");
  expect(messageUrl("sms", "+971501234567", "Hi")).toBe("sms:+971501234567?body=Hi");
  expect(messageUrl("sms", "+971501234567", "Hi", true)).toBe("sms:+971501234567&body=Hi");
});

it("only creates public links for a hosted cloud app, preserving its base path", async () => {
  for (const bad of ["http://127.0.0.1:1420", "https://tauri.localhost", "tauri://localhost", "https://192.168.1.2", "https://erp.internal", "https://me:secret@example.com", "bad"])
    expect(publicAppBase(bad)).toBeNull();
  vi.stubEnv("VITE_PUBLIC_APP_URL", "https://billing.example.com/filey/?source=app#/invoicing");
  expect(await invoicePublicLink(42)).toBe("https://billing.example.com/filey/#/portal/token%2F123");
  expect(billing.publicLink).toHaveBeenCalledExactlyOnceWith(42);
  vi.mocked(billing.publicLink).mockClear();
  vi.mocked(isLocalMode).mockReturnValue(true);
  await expect(invoicePublicLink(42)).rejects.toThrow("Share the PDF");
  vi.mocked(isLocalMode).mockReturnValue(false);
  vi.stubEnv("VITE_PUBLIC_APP_URL", "http://localhost:1420");
  await expect(invoicePublicLink(42)).rejects.toThrow("Share the PDF");
  expect(billing.publicLink).not.toHaveBeenCalled();
});

it.each([
  ["quotation", quotationPublicLink, () => quotes.publicLink],
  ["purchase order", purchaseOrderPublicLink, () => pos.publicLink],
  ["receipt", receiptPublicLink, () => receipts.publicLink],
] as const)("creates usable %s links and refuses localhost, local mode and failed publication", async (_kind, createLink, backend) => {
  vi.stubEnv("VITE_PUBLIC_APP_URL", "https://billing.example.com/filey/");
  expect(await createLink(9)).toBe("https://billing.example.com/filey/#/portal/token%2F123");
  expect(backend()).toHaveBeenCalledExactlyOnceWith(9);
  vi.mocked(backend()).mockClear();
  vi.mocked(isLocalMode).mockReturnValue(true);
  await expect(createLink(9)).rejects.toThrow("Share the PDF");
  vi.mocked(isLocalMode).mockReturnValue(false);
  vi.stubEnv("VITE_PUBLIC_APP_URL", "http://127.0.0.1:1420");
  await expect(createLink(9)).rejects.toThrow("Share the PDF");
  expect(backend()).not.toHaveBeenCalled();
  vi.stubEnv("VITE_PUBLIC_APP_URL", "https://billing.example.com/filey/");
  vi.mocked(backend()).mockRejectedValueOnce(new Error("Publication unavailable"));
  await expect(createLink(9)).rejects.toThrow("Publication unavailable");
});

it("uses the hosted app for desktop cloud links without a configured public URL", async () => {
  vi.stubEnv("VITE_PUBLIC_APP_URL", "");
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  expect(await purchaseOrderPublicLink(12)).toBe("https://app.gofiley.com/#/portal/token%2F123");
  expect(pos.publicLink).toHaveBeenCalledExactlyOnceWith(12);
});
