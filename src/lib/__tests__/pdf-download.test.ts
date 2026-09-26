import { beforeEach, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { downloadFile, downloadElementAsPdf } from "../pdfTools";

const save = vi.hoisted(() => vi.fn());
vi.mock("../localPaths", () => ({ hasTauri: true, saveBytes: save }));
vi.mock("html-to-image", () => ({
  toPng: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfusAAAAASUVORK5CYII=",
}));

beforeEach(() => {
  save.mockReset();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

it("returns false when the native output save dialog is canceled", async () => {
  save.mockResolvedValue(null);
  await expect(downloadFile({ name: "invoice.pdf", bytes: new Uint8Array([1, 2]) })).resolves.toBe(false);
});

it("returns true only after native writing completes, and reports write failures", async () => {
  save.mockResolvedValue("C:/Exports/invoice.pdf");
  await expect(downloadFile({ name: "invoice.pdf", bytes: new Uint8Array([1, 2]) })).resolves.toBe(true);
  save.mockRejectedValue(new Error("Disk is full"));
  await expect(downloadFile({ name: "invoice.pdf", bytes: new Uint8Array([1, 2]) })).rejects.toThrow("Disk is full");
});

it("propagates cancel through DOM PDF export without treating it as a recorded output", async () => {
  save.mockResolvedValue(null);
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const sheet = document.createElement("div");
  sheet.textContent = "Payslip";
  try {
    await expect(downloadElementAsPdf(sheet, "payslip")).resolves.toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toBe("payslip.pdf");
    const pdf = await PDFDocument.load(save.mock.calls[0][1]);
    expect(pdf.getPageCount()).toBe(1);
    expect(print).not.toHaveBeenCalled();
  } finally {
    print.mockRestore();
  }
});
