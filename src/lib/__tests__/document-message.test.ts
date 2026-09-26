import { afterEach, expect, it, vi } from "vitest";
import { internationalPhone, messageUrl, publicAppBase, invoicePublicLink } from "../documentMessage";
import { billing } from "../api";
import { isLocalMode } from "../dataMode";

vi.mock("../api", () => ({ billing: { publicLink: vi.fn(async () => "token/123") } }));
vi.mock("../dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataMode")>()),
  isLocalMode: vi.fn(() => false),
}));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.mocked(isLocalMode).mockReturnValue(false); });

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
