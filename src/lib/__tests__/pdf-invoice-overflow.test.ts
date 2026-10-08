import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { downloadElementAsPdf, elementToPdfBytes } from "../pdfTools";
import InvoiceExportSheet from "../../components/InvoiceExportSheet";
import { EMPTY_BANK } from "../../components/BankDetails";

const save = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => vi.fn(async (_node: HTMLElement) => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfusAAAAASUVORK5CYII="));
vi.mock("../localPaths", () => ({ hasTauri: true, saveBytes: save }));
vi.mock("html-to-image", () => ({ toPng: capture }));
vi.mock("../customTemplates", () => ({ useCustomTemplates: () => ({ templates: [], loading: false }) }));

const rect = (left: number, top: number, width: number, height: number) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
} as DOMRect);
const textRect = (parent: Element | null) => {
  const position = parent?.closest<HTMLElement>("[data-text-bottom], [data-text-right], [data-text-left]");
  const bottom = Number(position?.dataset.textBottom || 200);
  const right = Number(position?.dataset.textRight || 120);
  const left = Number(position?.dataset.textLeft ?? 16);
  // Capture clone is scaled2; real content starts at48 CSS pixels.
  return rect(96 + left * 2, 96 + (bottom - 14) * 2, (right - left) * 2, 28);
};
function sheet(body: string, marked = true) {
  const element = document.createElement("div");
  element.className = "invoice-print";
  element.style.cssText = "width:794px;height:1123px;overflow:hidden;padding:48px";
  element.innerHTML = `<div ${marked ? 'data-invoice-content="1027"' : ""} style="width:698px;min-height:1027px">${body}</div>`;
  return element;
}

beforeEach(() => {
  save.mockReset().mockResolvedValue("C:/Exports/invoice.pdf");
  capture.mockClear();
  vi.spyOn(window, "print").mockImplementation(() => {});
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-invoice-content") ? 698 : parseFloat(this.style.width) || 794;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return parseFloat(this.style.height) || 1123;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-invoice-content")) return rect(96, 96, 1396, 2054);
    if (this.hasAttribute("data-clip-height")) return rect(96, 96, Number(this.dataset.clipWidth || 698) * 2, Number(this.dataset.clipHeight) * 2);
    if (this.tagName === "IMG") return textRect(this);
    return rect(0, 0, 1588, 2246);
  });
  vi.spyOn(document, "createRange").mockImplementation(() => {
    let selected: Node | undefined;
    return {
      selectNodeContents: (node: Node) => { selected = node; },
      getClientRects: () => [textRect(selected?.parentElement || null)],
      detach: vi.fn(),
    } as unknown as Range;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("invoice PDF overflow protection", () => {
  it("blocks a long line clipped inside a fixed custom section before capture, save or print fallback", async () => {
    const element = sheet('<div style="height:900px;overflow:hidden"><p data-text-bottom="1060">Long invoice text ending below the content area</p></div>');
    document.body.appendChild(element);
    await expect(downloadElementAsPdf(element, "long-invoice")).rejects.toThrow("In Items, add a page break before a line");
    expect(capture).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(1); // Temporary capture clone was removed.
    expect(element.textContent).toContain("Long invoice text");
  });

  it("checks the invoice marker inside a one-page headless host, not only a page root", async () => {
    const host = document.createElement("div");
    host.id = "headless-invoice-host"; // jsdom25 mis-scopes :scope on an anonymous host.
    host.style.width = "794px";
    host.appendChild(sheet('<p data-text-right="800">An unbroken identifier wider than the invoice</p>'));
    document.body.appendChild(host);
    await expect(elementToPdfBytes(host, "wide-invoice")).rejects.toThrow("No PDF was exported");
    expect(capture).not.toHaveBeenCalled();
  });

  it("blocks custom-template content clipped above the A4 content limit", async () => {
    // An uploaded A4 template rendered at698px is986px tall, shorter than
    // the1027px content budget. The ink fits the paper but not its template.
    const element = sheet('<div data-clip-height="986" style="height:986px;overflow:hidden"><section><p data-text-bottom="1000">Saved footer hidden by the custom template</p></section></div>');
    await expect(downloadElementAsPdf(element, "clipped-template")).rejects.toThrow("No PDF was exported");
    expect(capture).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("checks only the axis that an ancestor clips", async () => {
    const vertical = sheet('<div data-clip-height="986" style="overflow-x:visible;overflow-y:clip"><p data-text-left="-24">Header within paper margins</p></div>');
    await expect(elementToPdfBytes(vertical, "vertical-clip")).resolves.toMatchObject({ name: "vertical-clip.pdf" });
    const horizontal = sheet('<div data-clip-height="986" style="overflow-x:clip;overflow-y:visible"><p data-text-bottom="1000">Visible below the template container</p></div>');
    await expect(elementToPdfBytes(horizontal, "horizontal-clip")).resolves.toMatchObject({ name: "horizontal-clip.pdf" });
    expect(capture).toHaveBeenCalledTimes(2);
    capture.mockClear();
    await expect(elementToPdfBytes(sheet('<div data-clip-height="986" style="overflow-x:clip;overflow-y:visible"><p data-text-right="710">Clipped on the right within paper margins</p></div>'), "side-clip")).rejects.toThrow("does not fit");
    expect(capture).not.toHaveBeenCalled();
  });

  it("checks clipped company images but ignores positioned marks and template backgrounds", async () => {
    const clipped = sheet('<div data-clip-height="986" style="overflow:hidden"><img data-text-bottom="1000" alt="Company logo" src="data:image/png;base64,AA==" /></div>');
    await expect(elementToPdfBytes(clipped, "clipped-logo")).rejects.toThrow("does not fit");
    expect(capture).not.toHaveBeenCalled();
    const decorated = sheet('<div data-clip-height="986" style="overflow:hidden"><p>Invoice fits</p><div data-template-background-status="ready"><img data-text-bottom="1000" alt="Background" src="data:image/png;base64,AA==" /></div><div data-doc-mark="Stamp"><span data-text-bottom="1000">Stamp decoration</span></div></div>');
    await expect(elementToPdfBytes(decorated, "clipped-decoration")).resolves.toMatchObject({ name: "clipped-decoration.pdf" });
    expect(capture).toHaveBeenCalledOnce();
  });

  it("checks every manually separated invoice page and never downloads a partially captured document", async () => {
    const host = document.createElement("div");
    host.id = "manual-invoice-pages";
    host.style.width = "794px";
    host.append(sheet("<p>Page one fits</p>"), sheet('<p data-text-bottom="1092">Page two overflows</p>'));
    document.body.appendChild(host);
    await expect(downloadElementAsPdf(host, "two-pages")).rejects.toThrow("does not fit on its A4 page");
    expect(capture.mock.calls.map(([node]) => node.textContent)).toEqual(["Page one fits"]);
    expect(save).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("allows a real A4 PDF when wide decorative wrappers extend into the margin but their text fits", async () => {
    const element = sheet('<div style="width:794px;margin-left:-48px;padding:48px"><p>Actual text fits</p></div>');
    const result = await elementToPdfBytes(element, "fitting-invoice");
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.5);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(842.25);
    expect(capture).toHaveBeenCalledOnce();
  });

  it.each(["classic", "em-modern", "em-corporate"])("allows %s template text within paper margins instead of treating its full-bleed header as overflow", async (template) => {
    const host = document.createElement("div");
    host.id = `margin-template-${template}`;
    host.style.width = "794px";
    host.innerHTML = renderToStaticMarkup(createElement(InvoiceExportSheet, {
      form: { template, doc_type: "invoice", number: "INV-MARGINS", currency: "USD", tax_country_code: "AE", fx_rate: 3.67,
        seller_name: "Margin Seller", customer_name: "Example Buyer", tax_rate: 5,
        einvoice: { seller: { tin: "1001234567" }, buyer: { legal_id: "BUYER-123" } },
        items: Array.from({ length: 3 }, (_, index) => ({ description: `Item ${index + 1}`, qty: 1, unit_price: 10 })),
      }, bank: EMPTY_BANK,
    }));
    const fullBleed = Array.from(host.querySelectorAll<HTMLElement>("div")).filter(node => node.classList.contains("-mx-12"));
    expect(fullBleed.length).toBeGreaterThan(0);
    // jsdom has no layout: supply the actual contract that these templates use,
    // with ink above/to the sides of content but wholly inside the paper edge.
    for (const block of fullBleed) {
      block.dataset.textBottom = "10";
      block.dataset.textLeft = "-24";
      block.dataset.textRight = "730";
    }
    document.body.appendChild(host);
    const result = await elementToPdfBytes(host, `${template}-invoice`);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
    expect(capture).toHaveBeenCalledOnce();
  });

  it.each(['data-text-left="-60"', 'data-text-bottom="-40"'])("still rejects text beyond the physical paper edge: %s", async (position) => {
    await expect(elementToPdfBytes(sheet(`<p ${position}>Outside the sheet</p>`), "outside-paper")).rejects.toThrow("does not fit");
    expect(capture).not.toHaveBeenCalled();
  });

  it("falls back to content bounds when a marked legacy export has no invoice paper wrapper", async () => {
    const element = sheet('<p data-text-right="730">Beyond available content</p>');
    element.className = "";
    await expect(elementToPdfBytes(element, "legacy-content")).rejects.toThrow("does not fit");
    expect(capture).not.toHaveBeenCalled();
  });

  it("checks visible invoice images while excluding background and positioned stamp decoration", async () => {
    await expect(elementToPdfBytes(sheet('<img data-text-bottom="1050" alt="Company logo" src="data:image/png;base64,AA==" />'), "large-logo")).rejects.toThrow("does not fit");
    expect(capture).not.toHaveBeenCalled();
    const decorated = sheet('<p>Invoice text fits</p><div data-template-background-status="ready"><span data-text-bottom="1100">Background decoration</span></div><div data-doc-mark="Stamp"><span data-text-bottom="1100">Stamp decoration</span></div>');
    await expect(elementToPdfBytes(decorated, "decorated-invoice")).resolves.toMatchObject({ name: "decorated-invoice.pdf" });
    expect(capture).toHaveBeenCalledOnce();
  });

  it("does not impose the invoice content budget on unrelated document exporters", async () => {
    const document = sheet('<p data-text-bottom="1092">Other document layout</p>', false);
    await expect(elementToPdfBytes(document, "other-document")).resolves.toMatchObject({ name: "other-document.pdf" });
    expect(capture).toHaveBeenCalledOnce();
  });
});
