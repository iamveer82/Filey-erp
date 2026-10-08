import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CompanyDetails from "../settings/CompanyDetails";
import CompanyModal from "../../components/CompanyModal";
import { billing, tools, type CompanyProfile } from "../../lib/api";
import { changeCompanyCountry, companyCountryCurrency, companyPhoneHint } from "../../lib/companyCountry";
import { COUNTRY_OPTIONS } from "../../lib/taxRegimes";
import { CURRENCIES, money } from "../../lib/format";
import { loadIndiaRegistration, saveIndiaRegistration } from "../../components/IndiaRegistrationFields";
import InvoiceExportSheet from "../../components/InvoiceExportSheet";
import { EMPTY_BANK } from "../../components/BankDetails";

vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { error: vi.fn(), success: vi.fn() } }) }));
vi.mock("../../components/DocPresetBar", () => ({ DocPresetsPanel: () => null }));

let company: CompanyProfile;
let settings: Map<string, string>;
beforeEach(() => {
  company = { name: "Fixture company", address: "Fixture address", country_code: "AE", currency: "AED", default_tax_rate: 5,
    tax_type: "VAT", default_accent: "#222222", default_template: "minimal", phone: "+971501234567" };
  settings = new Map([["company_bank", JSON.stringify({ iban: "AE070331234567890123456", ifsc: "HDFC0001234" })]]);
  vi.spyOn(billing, "getCompany").mockImplementation(async () => ({ ...company }));
  vi.spyOn(billing, "saveCompany").mockImplementation(async c => { company = { ...c }; });
  vi.spyOn(tools, "settings").mockImplementation(async () => Array.from(settings, ([key, value]) => ({ key, value })));
  vi.spyOn(tools, "setSetting").mockImplementation(async (key, value) => { settings.set(key, value); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function chooseCountry(name: string) {
  fireEvent.keyDown(screen.getByLabelText("Business country"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

it("switches the real company form to India and preserves registration and bank details across save/reopen", async () => {
  const view = render(<CompanyDetails />);
  await screen.findByLabelText("IBAN");
  expect(screen.getByLabelText("Phone Number")).toHaveAttribute("placeholder", "+971 50 123 4567");
  await chooseCountry("India");
  expect(screen.queryByLabelText("IBAN")).toBeNull();
  expect(screen.getByLabelText("IFSC Code")).toHaveValue("HDFC0001234");
  expect(screen.getByLabelText("GSTIN")).toBeInTheDocument();
  expect(screen.getByLabelText("Phone Number")).toHaveAttribute("placeholder", "+91 98765 43210");
  expect(screen.getByLabelText("Phone Number")).toHaveAttribute("type", "tel");
  expect(screen.getByLabelText("Phone Number")).toHaveValue("+971501234567"); // never rewrite customer values
  expect(screen.getByLabelText("PIN code")).toHaveAttribute("inputmode", "numeric");
  expect(screen.getByText("PIN code", {selector: "label"})).toBeVisible();
  expect(screen.getByText("GST settings")).toBeVisible();
  expect(screen.getByText("Default GST rate (%)", {selector: "label"})).toBeVisible();
  expect(screen.getByText("State / Union territory", {selector: "label"})).toBeVisible();
  expect(screen.queryByLabelText("MOHRE establishment ID")).toBeNull();
  expect(screen.queryByLabelText("Legal Registration ID")).toBeNull();
  fireEvent.change(screen.getByLabelText("PAN"), { target: {value: "abcde1234f"} });
  fireEvent.change(screen.getByLabelText("Aadhaar reference (last 4 digits)"), { target: {value: "1234"} });
  fireEvent.click(screen.getByRole("button", {name: "Save Changes"}));
  await waitFor(() => expect(tools.setSetting).toHaveBeenCalledWith("company_registration_in", expect.stringContaining("ABCDE1234F")));
  expect(company).toMatchObject({ country_code: "IN", currency: "INR", default_tax_rate: 5, tax_type: "GST" });
  view.unmount();
  render(<CompanyDetails />);
  expect(await screen.findByLabelText("PAN")).toHaveValue("ABCDE1234F");
  await chooseCountry("United Arab Emirates");
  expect(screen.getByText("VAT settings")).toBeVisible();
  expect(screen.getByText("Default VAT rate (%)", {selector: "label"})).toBeVisible();
  expect(screen.queryByText("PIN code", {selector: "label"})).toBeNull();
  expect(screen.getByLabelText("IBAN")).toHaveValue("AE070331234567890123456");
  expect(screen.queryByLabelText("PAN")).toBeNull();
  await chooseCountry("India");
  expect(screen.getByLabelText("PAN")).toHaveValue("ABCDE1234F");
});

it("validates optional registration details before writing and never accepts full Aadhaar numbers", async () => {
  await expect(saveIndiaRegistration({})).resolves.toBeUndefined();
  await expect(saveIndiaRegistration({pan: "ABCDE1234F", cin: "U12345MH2020PTC123456", aadhaar_last4: "1234"})).resolves.toBeUndefined();
  const saved = await loadIndiaRegistration();
  await expect(saveIndiaRegistration({aadhaar_last4: "123456789012"})).rejects.toThrow("Aadhaar");
  await expect(saveIndiaRegistration({pan: "INVALID"})).rejects.toThrow("PAN");
  expect(await loadIndiaRegistration()).toEqual(saved);
  settings.set("company_registration_in", "bad json");
  await expect(loadIndiaRegistration()).rejects.toThrow();
});

it("selects the country's currency while preserving explicit tax choices and entered IDs", () => {
  expect(changeCompanyCountry({...company, currency: "USD", default_tax_rate: 0, tax_type: "None", trn: "existing-id"}, "IN"))
    .toMatchObject({currency: "INR", default_tax_rate: 0, tax_type: "None", trn: "existing-id"});
  expect(company.currency).toBe("AED"); // changing the draft never mutates saved data
  expect(changeCompanyCountry({...company, currency: "USD"}, "").currency).toBe("USD");
  for (const {value} of COUNTRY_OPTIONS) {
    expect(CURRENCIES.some(c => c.code === companyCountryCurrency(value))).toBe(true);
    expect(companyPhoneHint(value)).toMatch(/^\+\d+ /);
  }
  expect(companyCountryCurrency("BG")).toBe("EUR");
  expect(companyCountryCurrency("PL")).toBe("PLN");
  expect(money(12.345, "KWD")).toContain("12.345");
  expect(money(12, "JPY")).not.toContain(".00");
});

it("allows a foreign currency override without changing the company's country", async () => {
  render(<CompanyDetails />);
  await screen.findByLabelText("Business country");
  await chooseCountry("India");
  expect(screen.getByLabelText("Default currency")).toHaveTextContent("INR");
  fireEvent.keyDown(screen.getByLabelText("Default currency"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name: "USD — US Dollar" }), { key: "Enter" });
  fireEvent.click(screen.getByRole("button", {name: "Save Changes"}));
  await waitFor(() => expect(company).toMatchObject({country_code: "IN", currency: "USD"}));
});

it("preserves legacy nested registration when company-modal TIN is edited", async () => {
  company.einvoice = { legal_id: "LEGACY-LICENCE", legal_id_type: "TL", tin: "1001234567" };
  render(<CompanyModal open company={company} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByText("Electronic invoicing identity"));
  expect(screen.getByLabelText("Legal registration number")).toHaveValue("LEGACY-LICENCE");
  fireEvent.change(screen.getByLabelText("Electronic invoicing TIN"), { target: { value: "1007774567" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Company" }));
  await waitFor(() => expect(company).toMatchObject({ legal_id: "LEGACY-LICENCE", legal_id_type: "TL",
    einvoice: { legal_id: "LEGACY-LICENCE", legal_id_type: "TL", tin: "1007774567" } }));
});

it("shows legacy registration in settings and allows explicitly clearing both stored representations", async () => {
  company.einvoice = { legal_id: "LEGACY-LICENCE", legal_id_type: "TL", tin: "1001234567" };
  render(<CompanyDetails />);
  expect(await screen.findByLabelText("Legal Registration ID")).toHaveValue("LEGACY-LICENCE");
  fireEvent.change(screen.getByLabelText("Legal Registration ID"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Electronic invoicing TIN"), { target: { value: "1007774567" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(company).toMatchObject({ legal_id: "", einvoice: { legal_id: "", tin: "1007774567" } }));
  expect(screen.getByLabelText("Legal Registration ID")).toHaveValue("");
});

it("prints only the bank identifiers belonging to the invoice's saved country", () => {
  const bank = {...EMPTY_BANK, iban: "AE070331234567890123456", ifsc: "HDFC0001234"};
  const form = {items: [], show_bank: true, tax_country_code: "IN", template: "minimal", currency: "INR"};
  const view = render(<InvoiceExportSheet form={form} bank={bank} />);
  expect(screen.getByText("HDFC0001234")).toBeInTheDocument();
  expect(screen.queryByText(bank.iban)).toBeNull();
  view.rerender(<InvoiceExportSheet form={{...form, tax_country_code: "AE"}} bank={bank} />);
  expect(screen.getByText(bank.iban)).toBeInTheDocument();
  expect(screen.queryByText(bank.ifsc)).toBeNull();
});
