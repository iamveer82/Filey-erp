import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPackagingForm, type PackagingForm } from "../../lib/packagingLists";
import { STAMP_DEFAULT, SIGN_DEFAULT } from "../StampSignature";
import PackagingListDocument, { PACKAGING_TEMPLATES, paginatePackagingItems } from "../PackagingListDocument";

function example(): PackagingForm {
  return {
    ...blankPackagingForm("PKG-2026-001"), company_name: "Northline Trading", company_address: "21 Market Road\nDubai, UAE",
    recipient_name: "Harbour Works", recipient_address: "12 Port Road", shipping_address: "Warehouse 4\nJebel Ali, Dubai",
    issue_date: "2026-10-01", invoice_reference: "INV-042", order_reference: "PO-089", carrier: "Local carrier",
    notes: "Handle with care.", prepared_by: "Alex Morgan", show_net_weight: true, show_gross_weight: true, show_packages: true,
    items: [
      { id: "chairs", description: "Dining chairs", qty: 8, unit: "pcs", package_type: "Carton", package_count: 4, net_weight: 5.5, gross_weight: 6 },
      { id: "fabric", description: "Upholstery fabric", qty: 12, unit: "m", package_type: "Roll", package_count: 1, net_weight: 0.5, gross_weight: 0.6 },
    ],
  };
}

const documentFor = (form: PackagingForm, pageIndex?: number) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PackagingListDocument form={form} pageIndex={pageIndex} />);
  return host;
};

describe("packing list documents", () => {
  it("keeps an ordinary eight-row manifest together when its layout has room for the full summary", () => {
    for (const font of ["'Plus Jakarta Sans', system-ui, sans-serif", "'Lora', Georgia, serif", "'IBM Plex Mono', monospace"]) {
      for (const { id } of PACKAGING_TEMPLATES) {
        const form = { ...example(), font, template: id };
        form.items = Array.from({ length: 8 }, (_, i) => ({ ...form.items[i % 2], id: `short-${i}` }));
        const pages = paginatePackagingItems(form);
        expect(pages).toHaveLength(id === "packing-minimal" || id === "packing-warehouse" ? 1 : 2);
        expect(pages[0].items).toHaveLength(8);
        const host = documentFor(form);
        expect(host.children).toHaveLength(pages.length);
        expect(host.querySelector(".packing-summary")!.textContent).toContain("Total packages20");
        expect(host.querySelectorAll(".packing-signoff")).toHaveLength(1);
        expect((host.firstElementChild as HTMLElement).style.fontFamily.replace(/"/g, "'")).toBe(font);
      }
    }
  });

  it("ignores values in hidden weight and package columns when placing pages", () => {
    const form = { ...example(), show_net_weight: false, show_gross_weight: false, show_packages: false };
    form.items = Array.from({ length: 8 }, (_, i) => ({ ...form.items[0], id: `hidden-${i}`, package_count: null, net_weight: null, gross_weight: null }));
    const blank = paginatePackagingItems(form);
    const populated = paginatePackagingItems({ ...form, items: form.items.map(item => ({ ...item, package_count: 1000000000000000, net_weight: 1.234567891234e-200, gross_weight: 1.234567891234e200, package_type: "Extremely large " + "x".repeat(44) })) });
    expect(populated.map(page => page.items.map(item => item.description))).toEqual(blank.map(page => page.items.map(item => item.description)));
    expect(populated).toHaveLength(1);
  });

  it("renders four packing-only compositions with complete shipment content", () => {
    const layouts = new Set<string>();
    for (const template of PACKAGING_TEMPLATES) {
      const host = documentFor({ ...example(), template: template.id });
      const sheet = host.querySelector("[data-packaging-template]")!;
      layouts.add(sheet.className);
      expect(sheet.getAttribute("data-packaging-template")).toBe(template.id);
      expect(sheet.getAttribute("data-pdf-single")).toBe("true");
      for (const value of ["Northline Trading", "Harbour Works", "Warehouse 4", "INV-042", "Dining chairs", "Handle with care.", "Alex Morgan"]) expect(host.textContent).toContain(value);
      expect(host.textContent).not.toMatch(/Unit Price|Amount due|VAT|Subtotal|Payment|Bank|AED/);
      expect(host.querySelectorAll(".packing-summary")).toHaveLength(1);
    }
    expect(layouts.size).toBe(4);
  });

  it("calculates line weights and full shipment totals while keeping quantity units separate", () => {
    const host = documentFor(example());
    const chairCells = host.querySelector('[data-packing-item="chairs"]')!.textContent;
    expect(chairCells).toContain("5.5");
    expect(chairCells).toContain("44");
    expect(chairCells).toContain("48");
    const totals = host.querySelector(".packing-summary")!.textContent;
    expect(totals).toContain("Quantity · pcs8");
    expect(totals).toContain("Quantity · m12");
    expect(totals).toContain("Total packages5");
    expect(totals).toContain("Total net weight50 kg");
    expect(totals).toContain("Total gross weight55.2 kg");
  });

  it("omits optional references and weight/package columns without printing financial fields", () => {
    const form = { ...example(), invoice_id: null, invoice_reference: "", show_net_weight: false, show_gross_weight: false, show_packages: false };
    const host = documentFor(form);
    expect(host.textContent).not.toMatch(/Invoice reference|INV-042|Net \/ unit|Gross \/ unit|Total packages|Total net weight|Total gross weight/);
    expect(host.querySelectorAll(".packing-items th")).toHaveLength(4);
    expect(host.textContent).toContain("PACKING LIST");
  });

  it("continues long descriptions and notes without losing text or duplicating totals", () => {
    const form = example();
    const description = "製造品の説明。Handle carefully.\n".repeat(130);
    const notes = "Shipping instruction — keep dry.\n".repeat(180);
    form.items = Array.from({ length: 36 }, (_, i) => ({ ...form.items[i % 2], id: `item-${i}`, description: i === 0 ? description : `Shipment item ${i}` }));
    form.notes = notes;
    const pages = paginatePackagingItems(form);
    expect(pages.length).toBeGreaterThan(4);
    expect(pages.flatMap(page => page.items).filter(item => item.id === "item-0").map(item => item.description).join("")).toBe(description);
    expect(pages.map(page => page.notes).join("")).toBe(notes);
    expect(pages.flatMap(page => page.items).filter(item => !item.continuation)).toHaveLength(36);
    const host = documentFor(form);
    expect(host.children).toHaveLength(pages.length);
    expect(host.querySelectorAll(".packing-summary")).toHaveLength(1);
    expect(host.querySelectorAll(".packing-signoff")).toHaveLength(1);
    expect(host.querySelectorAll(".packing-header")).toHaveLength(pages.length);
    const last = host.lastElementChild!;
    expect(last.querySelector(".packing-summary")).not.toBeNull();
    expect(last.textContent).toContain(`Page ${pages.length} of ${pages.length}`);
    const first = documentFor(form, 0);
    expect(first.children).toHaveLength(1);
    expect(first.querySelector(".packing-summary")).toBeNull();
  });

  it("uses full-opacity company marks on the last sheet", () => {
    const form = { ...example(), show_stamp: true, show_signature: true };
    const data = "data:image/png;base64,example";
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PackagingListDocument form={form} companyStampSig={{ stamp: { ...STAMP_DEFAULT, data }, signature: { ...SIGN_DEFAULT, data } }} />);
    const marks = Array.from(host.querySelectorAll<HTMLImageElement>("[data-doc-mark] img"));
    expect(marks).toHaveLength(2);
    expect(marks.every(mark => mark.style.opacity === "1")).toBe(true);
  });

  it("continues quantity summaries when a shipment has many distinct units", () => {
    const form = example();
    form.items = Array.from({ length: 90 }, (_, i) => ({ ...form.items[0], id: `unit-${i}`, unit: `unit-${i}`, description: `Contents ${i}` }));
    const pages = paginatePackagingItems(form);
    const quantities = pages.flatMap(page => page.quantities);
    expect(quantities).toHaveLength(90);
    expect(new Set(quantities.map(([unit]) => unit)).size).toBe(90);
    expect(Math.max(...pages.map(page => page.quantities.length))).toBeLessThan(form.items.length);
    const host = documentFor(form);
    expect(host.querySelectorAll(".packing-summary")).toHaveLength(1);
    expect(host.querySelectorAll(".packing-quantity-continuation").length).toBeGreaterThan(0);
  });

  it("compacts long headers and preserves full details before using short continuation headers", () => {
    const form = example();
    form.company_name = "Northline International Company ".repeat(6).slice(0, 160);
    form.company_address = "Business Park, Building 27, Logistics Centre, Dubai, United Arab Emirates. ".repeat(6).slice(0, 400);
    form.recipient_name = "Harbour International Manufacturing ".repeat(6).slice(0, 160);
    form.recipient_address = "Warehouse district, Business Centre, Jebel Ali, Dubai, United Arab Emirates. ".repeat(6).slice(0, 400);
    form.shipping_address = form.recipient_address;
    form.company_email = "a".repeat(240) + "@example.com";
    form.recipient_email = "b".repeat(240) + "@example.com";
    form.invoice_reference = "INV-" + "x".repeat(116);
    form.order_reference = "ORDER-" + "y".repeat(114);
    form.tracking_number = "TRACK-" + "z".repeat(114);
    form.company_logo = "data:image/png;base64,example";
    form.items = Array.from({ length: 36 }, (_, i) => ({ ...form.items[0], id: `long-header-${i}` }));
    for (const { id } of PACKAGING_TEMPLATES) {
      const selected = { ...form, template: id };
      const pages = paginatePackagingItems(selected);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.flatMap(page => page.items).filter(item => !item.continuation)).toHaveLength(36);
      const host = documentFor(selected);
      const first = host.firstElementChild!;
      expect(first.classList.contains("packing-compact")).toBe(true);
      for (const text of [form.company_address, form.recipient_address, form.company_email, form.recipient_email, form.invoice_reference, form.order_reference, form.tracking_number]) expect(first.textContent).toContain(text);
      const next = host.children[1];
      expect(next.classList.contains("packing-continuation")).toBe(true);
      expect(next.querySelector(".packing-brand")!.textContent).not.toContain(form.company_address);
      expect(next.textContent).toContain(form.company_name);
      expect(next.textContent).toContain(form.shipping_address);
      expect(host.querySelectorAll(".packing-signoff")).toHaveLength(1);
    }
  });
});
