import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import DocView, { type DocViewForm } from "../DocView";
import TemplateBackground from "../TemplateBackground";
import type { CustomTemplate } from "../TemplateDesigner";
import { getDocument } from "../../lib/pdfjsSafe";
import { downloadElementAsPdf, elementToPdfBytes } from "../../lib/pdfTools";

vi.mock("../../lib/pdfjsSafe", () => ({ getDocument: vi.fn(), pdfjs: {} }));
vi.mock("html-to-image", () => ({ toPng: vi.fn(async () => { throw new Error("Capture reached"); }) }));

const template: CustomTemplate = {
  id: "custom-render-test", name: "Custom example", type: "builder", layout: "minimal", accent: "#334455", font: "Lora, serif",
  showLogo: true, showSeller: true, showCustomer: true, showNotes: true, showTerms: true, showTax: true, paperSize: "A4",
};
const form: DocViewForm = {
  template: template.id, accent: template.accent, seller_name: "Seller Ltd", customer_name: "Buyer Ltd", number: "INV-EXAMPLE",
  currency: "AED", tax_country_code: "AE", tax_rate: 5, issue_date: "2026-01-15", due_date: "2026-02-14",
  seller_address: "Seller address", customer_address: "Buyer address", seller_trn: "Seller tax ID",
  notes: "Internal note example", terms: "Payment term example", logo: "data:image/png;base64,AA==",
  items: [{ description: "Project service", qty: 1, unit_price: 100 }],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("custom document rendering", () => {
  it.each(["minimal", "classic", "modern"] as const)("uses the chosen %s layout and custom font", (layout) => {
    const custom = render(<DocView form={form} customTemplate={{ ...template, layout }} />);
    const builtin = render(<DocView form={{ ...form, template: layout }} />);
    // The selected builder layout must render the same document structure as
    // choosing that built-in layout, with the saved font applied to its root.
    expect(custom.container.firstElementChild?.innerHTML).toBe(builtin.container.firstElementChild?.innerHTML);
    expect((custom.container.firstElementChild as HTMLElement).style.fontFamily).toBe("Lora, serif");
  });

  it.each(["minimal", "classic", "modern"] as const)("honors hidden sections in %s without changing tax or the amount due", (layout) => {
    const configured: CustomTemplate = {
      ...template, layout, showSeller: false, showCustomer: false, showLogo: false, showNotes: false, showTerms: false, showTax: false,
    };
    const view = render(<DocView form={form} customTemplate={configured} />);
    expect(view.container.textContent).not.toMatch(/Seller Ltd|Buyer Ltd|Seller address|Buyer address|Seller tax ID|Internal note example|Payment term example|VAT/);
    expect(view.queryByRole("img", { name: "logo" })).toBeNull();
    expect(view.getByText(/105\.00/)).toBeTruthy();
    expect(view.getByText("Project service")).toBeTruthy();
  });
});

describe("uploaded PDF backgrounds", () => {
  it("keeps uploaded-template sections within the sheet and outside the side-by-side totals", () => {
    const configured: CustomTemplate = {
      ...template, type: "file", fileType: "image", fileData: "data:image/png;base64,AA==",
      positions: { items: { x: 6, y: 38 }, totals: { x: 70, y: 38 } },
    };
    const view = render(<DocView form={form} customTemplate={configured} />);
    const tableSection = view.getByRole("table").parentElement as HTMLElement;
    const totalsSection = view.getByText("Total").closest(".absolute") as HTMLElement;
    const tableRight = parseFloat(tableSection.style.left) + parseFloat(tableSection.style.width);
    const totalsRight = parseFloat(totalsSection.style.left) + parseFloat(totalsSection.style.width);
    expect(tableRight).toBeLessThanOrEqual(parseFloat(totalsSection.style.left));
    expect(totalsRight).toBeLessThanOrEqual(100);
    expect((view.container.firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("renders the first page, releases PDF resources and becomes ready only when the image loads", async () => {
    const destroy = vi.fn(async () => {});
    const draw = vi.fn(() => ({ promise: Promise.resolve() }));
    const page = { getViewport: () => ({ width: 794, height: 1122 }), render: draw };
    const getPage = vi.fn(async () => page);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ getPage }), destroy } as unknown as ReturnType<typeof getDocument>);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cGljdHVyZQ==");
    const view = render(<TemplateBackground data="data:application/pdf;base64,JVBERi1zdWNjZXNz" type="pdf" />);
    const image = await view.findByRole("img", { name: "Template background" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,cGljdHVyZQ==");
    expect(getPage).toHaveBeenCalledWith(1);
    expect(draw).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(view.container.firstElementChild).toHaveAttribute("data-template-background-status", "loading");
    fireEvent.load(image);
    expect(view.container.firstElementChild).toHaveAttribute("data-template-background-status", "ready");
  });

  it("shows a PDF read failure and blocks document export instead of producing a blank background", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const destroy = vi.fn(async () => {});
    vi.mocked(getDocument).mockImplementation(() => ({ promise: Promise.reject(new Error("This PDF is damaged")), destroy }) as unknown as ReturnType<typeof getDocument>);
    const view = render(<TemplateBackground data="data:application/pdf;base64,JVBERi1mYWlsdXJl" type="pdf" />);
    expect(await view.findByRole("alert")).toHaveTextContent("This PDF is damaged");
    expect(destroy).toHaveBeenCalledOnce();
    await expect(elementToPdfBytes(view.container, "sample")).rejects.toThrow("The template background could not be loaded.");
    await expect(downloadElementAsPdf(view.container, "sample")).rejects.toThrow("The template background could not be loaded.");
    expect(print).not.toHaveBeenCalled();
  });

  it("stops export after the template image loading timeout", async () => {
    const view = render(<TemplateBackground data="data:image/png;base64,cGVuZGluZw==" type="image" />);
    await waitFor(() => expect(view.container.firstElementChild).toHaveAttribute("data-template-background-status", "loading"));
    vi.useFakeTimers();
    const attempt = expect(elementToPdfBytes(view.container, "sample")).rejects.toThrow("The template background is still loading.");
    await vi.advanceTimersByTimeAsync(10000);
    await attempt;
  });

  it("waits for a freshly mounted background before reaching PDF capture", async () => {
    const view = render(<TemplateBackground data="data:image/png;base64,bmV3" type="image" />);
    const attempt = expect(elementToPdfBytes(view.container, "sample")).rejects.toThrow("Capture reached");
    fireEvent.load(await view.findByRole("img", { name: "Template background" }));
    await attempt;
  });

  it("ignores loading backgrounds outside the exported document", async () => {
    render(<TemplateBackground data="data:image/png;base64,b3RoZXI=" type="image" />);
    const target = document.createElement("div");
    target.textContent = "A normal document";
    await expect(elementToPdfBytes(target, "sample")).rejects.toThrow("Capture reached");
  });
});
