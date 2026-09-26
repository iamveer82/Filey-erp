import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { templatesForDocType } from "../DocTemplates";

const form: DocViewForm = {
  seller_name: "Northline Studio", seller_address: "14 Park Street", seller_trn: "100234567890003",
  customer_name: "Harbour Works", customer_address: "21 Market Road", customer_trn: "100999888777003",
  number: "INV-DESIGN-042", currency: "AED", tax_country_code: "AE", accent: "#faca1a",
  issue_date: "2026-09-08", due_date: "2026-10-08", tax_rate: 5,
  notes: "Please reference the invoice number.", terms: "Due within 30 days.",
  items: [
    { description: "Brand identity design", qty: 2, unit_price: 750, unit: "day", custom: { project: "Brand launch" } },
    { description: "Print production", qty: 4, unit_price: 125, unit: "unit" },
  ],
};
const pack = templatesForDocType("invoice").filter((template) => template.id.startsWith("uae-"));
const render = (template: string, extras: Partial<DocViewForm> = {}) => renderToStaticMarkup(<DocView form={{ ...form, template, ...extras }} />);

describe("distinct invoice layouts", () => {
  it("gives every former reference-pack invoice a distinct composition", () => {
    const structures = pack.map(({ id }) => {
      const page = document.createElement("div");
      page.innerHTML = render(id);
      expect(page.querySelector("[data-invoice-layout]")?.getAttribute("data-invoice-layout")).toBe(id);
      return page.querySelector(".invoice-layout")!.className;
    });
    expect(new Set(structures).size).toBe(pack.length);
  });

  it.each(pack)("$name retains business content and correct full-document totals", ({ id }) => {
    const html = render(id);
    for (const value of [form.seller_name!, form.customer_name!, form.number!, form.items[0].description, form.notes!, form.terms!]) {
      expect(html).toContain(value);
    }
    expect(html).toContain(id === "uae-margin" || id === "uae-commercial" ? "2,000.00" : "2,100.00");
    expect(html).toContain(form.seller_trn!);
    expect(html).toContain(form.customer_trn!);
  });

  it.each(pack)("$name respects manual page breaks, final-page totals and footer", ({ id }) => {
    const html = renderToStaticMarkup(<DocView form={{ ...form, template: id }} pageItems={[form.items[1]]} itemStartIndex={8} showTotals={false} showFooter={false} />);
    expect(html).toContain("Print production");
    expect(html).not.toContain("Brand identity design");
    expect(html).not.toContain("invoice-totals");
    expect(html).not.toContain("invoice-signatures");
    expect(html).not.toContain(form.terms!);
    expect(html).toContain('data-column="idx"');
    expect(html).toMatch(/>9<\/td>/);
  });

  it("keeps custom line columns in the designed invoice tables", () => {
    const html = render("uae-full", { customColumns: [{ key: "project", label: "Project" }] });
    expect(html).toContain("Project</th>");
    expect(html).toContain("Brand launch</td>");
  });

  it("keeps long business names, addresses and descriptions complete on a final page", () => {
    const seller = "Northline International Architecture, Design and Construction Consultancy Limited";
    const customer = "Harbour Works Manufacturing, Supply and Facilities Management Company";
    const longItem = { ...form.items[1], description: "Print production, finishing, packaging, delivery and installation for the complete multi-location brand rollout and signage programme" };
    const html = renderToStaticMarkup(<DocView
      form={{ ...form, template: "uae-full", seller_name: seller, customer_name: customer, seller_address: "Building 24, Office 1703\nBusiness Centre\nPark Street\nDubai, United Arab Emirates", items: [form.items[0], longItem] }}
      pageItems={[longItem]} itemStartIndex={1}
    />);
    expect(html).toContain(seller);
    expect(html).toContain(customer);
    expect(html).toContain(longItem.description);
    expect(html).not.toContain(form.items[0].description);
    expect(html).toContain("2,100.00"); // full invoice, not just this page's 500
    expect(html).toContain("invoice-signatures");
  });

  it.each(["uae-full", "uae-freelancer", "uae-hotel", "uae-designated"])("keeps %s composition but uses Indian tax content for a saved non-UAE document", (id) => {
    const html = render(id, { currency: "INR", tax_country_code: "IN", tax_rate: 18, seller_trn: "27ABCDE1234F1Z5" });
    expect(html).toContain(`data-invoice-layout="${id}"`);
    expect(html).toContain("GSTIN: 27ABCDE1234F1Z5");
    expect(html).toContain("GST (18%)");
    expect(html).toContain("2,360.00");
    expect(html).not.toMatch(/United Arab Emirates|Cabinet Decision|فاتورة|VAT Breakdown/);
  });

  it.each(["classic", "corporate", "bold", "fresh"])("keeps %s table headings readable on light backgrounds", (id) => {
    const page = document.createElement("div");
    page.innerHTML = render(id);
    const header = page.querySelector("thead tr") as HTMLElement;
    expect(header.style.color).toBe("rgb(17, 17, 17)");
  });
});
