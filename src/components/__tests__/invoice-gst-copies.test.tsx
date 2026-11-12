import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { GST_COPY_SETS } from "../../lib/gstCopies";
import { EMPTY_BANK } from "../BankDetails";

afterEach(cleanup);

const form = {
  template: "minimal", currency: "INR", tax_country_code: "IN", tax_rate: 18, number: "INV-C-1", seller_name: "Seller",
  items: [{ description: "Engine oil", qty: 10, unit_price: 100 }],
};

it("prints one full set of pages per GST copy, each labelled", () => {
  const { container } = render(<InvoiceExportSheet form={form} bank={EMPTY_BANK} copies={GST_COPY_SETS["3"]} />);
  const pages = [...container.querySelectorAll<HTMLElement>(".invoice-print")];
  expect(pages.map((page) => page.dataset.invoiceCopy)).toEqual(["Original for recipient", "Duplicate for transporter", "Triplicate for supplier"]);
  expect(pages[1].textContent).toContain("INV-C-1");
});

it("prints a single unlabelled set by default", () => {
  const { container } = render(<InvoiceExportSheet form={form} bank={EMPTY_BANK} />);
  const pages = container.querySelectorAll<HTMLElement>(".invoice-print");
  expect(pages).toHaveLength(1);
  expect(pages[0].dataset.invoiceCopy).toBeUndefined();
  expect(GST_COPY_SETS["2"]).toEqual(["Original for recipient", "Duplicate for supplier"]);
});
