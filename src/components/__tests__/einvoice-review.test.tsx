import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EInvoiceReview from "../EInvoiceReview";
import { UIProvider } from "../../lib/ui";
import type { EInvoiceDetails } from "../../lib/einvoice";
import type { EInvoiceDoc } from "../../lib/einvoiceXml";

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
  fireEvent.change(screen.getByLabelText(/^Free-zone beneficiary identifier/), { target: { value: "DEMO-BENEFICIARY" } });
  fireEvent.change(screen.getByLabelText(/^Delivery address/), { target: { value: "Demo Street" } });
  fireEvent.change(screen.getByLabelText(/^Delivery city/), { target: { value: "Mumbai" } });
  fireEvent.change(screen.getByLabelText(/^Delivery country code/), { target: { value: "in" } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ beneficiary_id: "DEMO-BENEFICIARY",
    buyer_delivery_mode: "export-unregistered", delivery: { address: "Demo Street", city: "Mumbai", country_code: "IN" } }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Buyer/ }), { button: 0, ctrlKey: false });
  expect(screen.getByRole("textbox", { name: "Buyer identifier" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
});

const prepared: EInvoiceDoc = {
  number: "INV-CHECK", issue_date: "2026-10-03", due_date: "2026-10-31", currency: "AED", tax_country_code: "AE",
  invoice_type_code: "380", transaction_type: "00000000", payment_means_code: "10", tax_rate: 5,
  seller_name: "Demo seller", seller_address: "Office 1", seller_city: "Dubai", seller_country_subdivision: "DXB",
  seller_trn: "100123456700003", seller_legal_id: "DEMO-TL", seller_legal_id_type: "TL",
  customer_name: "Demo buyer", customer_address: "Office 2", buyer_city: "Dubai", buyer_country_subdivision: "DXB",
  buyer_country_code: "AE", customer_trn: "100777456700003",
  einvoice: { seller: { tin: "1001234567", legal_authority: "Dubai Economy" }, buyer: { tin: "1007774567" } },
  items: [{ description: "Demo service", qty: 1, unit_price: 100, unit: "HUR", tax_category: "S" }],
};

it("groups live checks, focuses a missing seller field and enables export only after correction", () => {
  const exported = vi.fn(), fix = vi.fn();
  function Example() {
    const [doc, setDoc] = useState({ ...prepared, seller_address: "" });
    return <UIProvider><EInvoiceReview open doc={doc} busy={false} onClose={() => {}} onDocumentChange={setDoc}
      onChange={einvoice => setDoc({ ...doc, einvoice })} onFix={fix} onExport={exported} /></UIProvider>;
  }
  render(<Example />);
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
  const seller = screen.getByRole("tab", { name: /^Seller/ });
  expect(within(seller).getByText("1 to review")).toBeVisible();
  fireEvent.mouseDown(seller, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: /Edit: Seller.*street address/ }));
  const address = screen.getByRole("textbox", { name: "Seller street address" });
  expect(address).toHaveFocus();
  expect(address).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(address, { target: { value: "Office 1" } });
  expect(within(seller).getByText("Checks passed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeEnabled();
  expect(screen.getByText("Ready for XML preparation")).toBeVisible();
  expect(screen.getByText(/This check is not FTA approval/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save & export XML" }));
  expect(exported).toHaveBeenCalledOnce();
  expect(fix).not.toHaveBeenCalled();
});

it("explains the document UUID separately from FTA identity and blocks a corrupt saved UUID", () => {
  const changed = vi.fn();
  const props = { open: true, busy: false, onClose: () => {}, onChange: changed, onFix: () => {}, onExport: () => {} };
  const view = render(<UIProvider><EInvoiceReview {...props} doc={prepared} /></UIProvider>);
  expect(screen.getByRole("textbox", { name: "Preparation UUID" })).toHaveAttribute("readonly");
  expect(screen.getByRole("textbox", { name: "Preparation UUID" })).toHaveAttribute("placeholder", "Assigned when saved");
  expect(screen.getByText(/separate from your FTA-issued TRN\/TIN/)).toBeVisible();
  expect(screen.getByText(/provider is responsible for generating the final/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeEnabled();
  view.rerender(<UIProvider><EInvoiceReview {...props} doc={{ ...prepared, einvoice: { ...prepared.einvoice, uuid: "invalid-saved-uuid" } }} /></UIProvider>);
  expect(screen.getByRole("textbox", { name: "Preparation UUID" })).toHaveValue("invalid-saved-uuid");
  expect(screen.getByRole("textbox", { name: "Preparation UUID" })).toHaveAttribute("aria-invalid", "true");
  expect(screen.queryByRole("button", { name: /Edit:.*UUID/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save & export XML" })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});

it("keeps registered identities and bank details empty until an explicit edit or copy", () => {
  const changed = vi.fn();
  render(<UIProvider><EInvoiceReview open busy={false} doc={{ ...prepared, payment_means_code: "30",
    einvoice: { seller: {}, buyer: {} } }} bankAccount={{ id: "AE-DEMO-ACCOUNT", name: "Demo account" }}
    onClose={() => {}} onChange={changed} onFix={() => {}} onExport={() => {}} /></UIProvider>);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Seller/ }), { button: 0, ctrlKey: false });
  expect(screen.getByRole("textbox", { name: "Electronic invoicing TIN" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Own FTA-issued TRN" })).toHaveValue("");
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Tax & Payment/ }), { button: 0, ctrlKey: false });
  expect(screen.getByRole("textbox", { name: "Bank account / IBAN" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Use saved bank account" }));
  expect(changed).toHaveBeenLastCalledWith({ seller: {}, buyer: {}, payment_account_id: "AE-DEMO-ACCOUNT", payment_account_name: "Demo account" });
});
