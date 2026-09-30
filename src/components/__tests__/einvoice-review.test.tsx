import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EInvoiceReview from "../EInvoiceReview";
import { UIProvider } from "../../lib/ui";
import type { EInvoiceDetails } from "../../lib/einvoice";

afterEach(cleanup);

it("lets export/free-zone credit notes keep their required delivery and beneficiary details", () => {
  const changed = vi.fn();
  function Example() {
    const [details, setDetails] = useState<EInvoiceDetails>({ buyer_delivery_mode: "export-unregistered" });
    return <UIProvider><EInvoiceReview open busy={false} onClose={() => {}} onFix={() => {}} onExport={() => {}}
      doc={{ number: "DEMO-CREDIT", invoice_type_code: "81", transaction_type: "10000001", currency: "AED", tax_rate: 0, einvoice: details,
        items: [{ description: "Demo service", qty: 1, unit_price: 10, unit: "HUR", tax_category: "O" }] }}
      onChange={value => { changed(value); setDetails(value); }} /></UIProvider>;
  }
  render(<Example />);
  expect(screen.getByRole("combobox", { name: "Reason for credit note" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Free-zone beneficiary identifier"), { target: { value: "DEMO-BENEFICIARY" } });
  fireEvent.change(screen.getByLabelText("Delivery address"), { target: { value: "Demo Street" } });
  fireEvent.change(screen.getByLabelText("Delivery city"), { target: { value: "Mumbai" } });
  fireEvent.change(screen.getByLabelText("Delivery country code"), { target: { value: "in" } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ beneficiary_id: "DEMO-BENEFICIARY",
    buyer_delivery_mode: "export-unregistered", delivery: { address: "Demo Street", city: "Mumbai", country_code: "IN" } }));
  expect(screen.getByRole("textbox", { name: "Buyer identifier" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
});
