import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { billing, setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import ScanDocModal from "../ScanDocModal";
import { extractInvoiceFromImage } from "../../lib/ai";
import { fileToImages } from "../../lib/docScan";

vi.mock("../../lib/ai", () => ({ aiReady: () => true, extractInvoiceFromImage: vi.fn(async () => ({
  customer_name: "Scanned buyer", seller_name: "Scanned supplier", currency: "AED", items: [{ description: "Goods", qty: 2, unit_price: 50 }],
})) }));
vi.mock("../../lib/docScan", () => ({ fileToImages: vi.fn(async () => [{ mediaType: "image/png", dataBase64: "fixture" }]) }));

beforeEach(() => {
  localStorage.clear(); setDataMode("local"); setCacheOrg("scan-org", "scan-user");
  vi.clearAllMocks();
  vi.spyOn(billing, "saveDoc").mockResolvedValue(42);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Our company", country_code: "AE", city: "Dubai", country_subdivision: "DXB",
    legal_id: "LICENCE-1", legal_id_type: "TL", default_template: "minimal", default_accent: "#111111",
    einvoice: { tin: "1001234567", legal_authority: "Dubai Economy" },
  });
});
afterEach(() => { cleanup(); setCacheOrg(null); vi.restoreAllMocks(); });

async function scan(mode: "sales" | "purchase" = "sales") {
  const view = render(<MemoryRouter><UIProvider><ScanDocModal open onClose={() => {}} mode={mode} /></UIProvider></MemoryRouter>);
  fireEvent.change(view.baseElement.querySelector('input[type="file"]')!, { target: { files: [new File(["fixture"], "invoice.png", { type: "image/png" })] } });
  const create = await view.findByRole("button", { name: "Create draft invoice from scan" });
  return { view, create };
}

it.each(["sales", "purchase"] as const)("copies fresh seller e-invoice presets into a scanned %s draft", async mode => {
  const { create } = await scan(mode);
  fireEvent.click(create);
  await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledOnce());
  expect(billing.getCompany).toHaveBeenCalledWith(true);
  expect(vi.mocked(billing.saveDoc).mock.calls[0][0]).toMatchObject({
    seller_name: "Our company", seller_city: "Dubai", seller_legal_id: "LICENCE-1", seller_country_subdivision: "DXB",
    customer_name: mode === "sales" ? "Scanned buyer" : "Scanned supplier",
    einvoice: { seller: { tin: "1001234567", legal_id: "LICENCE-1", legal_authority: "Dubai Economy" } },
  });
});

it("does not create a scan draft when current company details cannot be read", async () => {
  vi.mocked(billing.getCompany).mockRejectedValue(new Error("Company unavailable"));
  const { view, create } = await scan(); fireEvent.click(create);
  await view.findByText("Company unavailable");
  expect(billing.saveDoc).not.toHaveBeenCalled();
});

it("does not apply the old company's scan to a switched workspace", async () => {
  const preset = await billing.getCompany();
  vi.mocked(billing.getCompany).mockImplementation(async () => { setCacheOrg("other-org", "scan-user"); return preset; });
  const { view, create } = await scan(); fireEvent.click(create);
  await view.findByText("Your account changed. Start the assistant task again.");
  expect(billing.saveDoc).not.toHaveBeenCalled();
});

it("preserves a reviewed zero quantity and extracted unit", async () => {
  vi.mocked(extractInvoiceFromImage).mockResolvedValueOnce({ customer_name: "Buyer", items: [{ description: "Oil", qty: 2, unit_price: 4.1, unit: "L" }] });
  const { view, create } = await scan();
  fireEvent.change(view.getByRole("textbox", { name: "Line 1 quantity" }), { target: { value: "0" } });
  fireEvent.click(create);
  await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledOnce());
  expect(vi.mocked(billing.saveDoc).mock.calls[0][0].items[0]).toMatchObject({ qty: 0, unit_price: 4.1, unit: "L" });
});

it("does not upload a converted file after the account changes", async () => {
  let finish!: (images: Awaited<ReturnType<typeof fileToImages>>) => void;
  vi.mocked(fileToImages).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<MemoryRouter><UIProvider><ScanDocModal open onClose={() => {}} /></UIProvider></MemoryRouter>);
  fireEvent.change(view.baseElement.querySelector('input[type="file"]')!, { target: { files: [new File(["fixture"], "invoice.png")] } });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  setCacheOrg("other-org", "scan-user");
  setCacheOrg("scan-org", "scan-user");
  await act(async () => finish([{ mediaType: "image/png", dataBase64: "fixture" }]));
  expect(extractInvoiceFromImage).not.toHaveBeenCalled();
  await view.findByText("Your workspace changed. Scan the document again.");
});

it.each(["close", "edit", "switch"])("does not save stale scan details after %s", async action => {
  const company = await billing.getCompany();
  let finish!: () => void;
  vi.mocked(billing.getCompany).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(company); }));
  const { view, create } = await scan();
  fireEvent.click(create);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  if (action === "close") view.unmount();
  else if (action === "edit") fireEvent.change(view.getByRole("textbox", { name: "Line 1 quantity" }), { target: { value: "7" } });
  else { setCacheOrg("other-org", "scan-user"); setCacheOrg("scan-org", "scan-user"); }
  await act(async () => finish());
  expect(billing.saveDoc).not.toHaveBeenCalled();
});

it("reuses the exact invoice and request identity after an uncertain save", async () => {
  vi.mocked(billing.saveDoc).mockRejectedValueOnce(new Error("Lost save response"));
  const { view, create } = await scan();
  fireEvent.click(create);
  await view.findByText("Lost save response");
  fireEvent.click(create);
  await waitFor(() => expect(billing.saveDoc).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(billing.saveDoc).mock.calls;
  expect(second[0]).toBe(first[0]);
  expect(second[1]).toBe(first[1]);
  expect(first[1]).toMatch(/^[a-f0-9-]{36}$/);
});

it("does not turn an uncertain scan save into a different invoice", async () => {
  vi.mocked(billing.saveDoc).mockRejectedValueOnce(new Error("Lost save response"));
  const { view, create } = await scan();
  fireEvent.click(create);
  await view.findByText("Lost save response");
  fireEvent.change(view.getByRole("textbox", { name: "Line 1 quantity" }), { target: { value: "9" } });
  fireEvent.click(create);
  await view.findByText("An earlier scan save still needs verification. Review pending saves in Invoicing before starting another draft.");
  expect(billing.saveDoc).toHaveBeenCalledOnce();
});

it.each(["close", "unmount", "mode", "workspace"])("cancels pending extraction after %s", async action => {
  let finish!: () => void;
  vi.mocked(extractInvoiceFromImage).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ customer_name: "Old scan", items: [{ description: "Goods", qty: 1, unit_price: 10 }] });
  }));
  const panel = (mode: "sales" | "purchase" = "sales") => <MemoryRouter><UIProvider><ScanDocModal open onClose={() => {}} mode={mode} /></UIProvider></MemoryRouter>;
  const view = render(panel());
  fireEvent.change(view.baseElement.querySelector('input[type="file"]')!, { target: { files: [new File(["fixture"], "invoice.png", { type: "image/png" })] } });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const signal = vi.mocked(extractInvoiceFromImage).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  if (action === "close") fireEvent.click(view.getByRole("button", { name: "Close dialog" }));
  else if (action === "unmount") view.unmount();
  else if (action === "mode") view.rerender(panel("purchase"));
  else setCacheOrg("other-org", "scan-user");
  expect(signal?.aborted).toBe(true);
  await act(async () => finish());
  expect(billing.saveDoc).not.toHaveBeenCalled();
  expect(view.queryByDisplayValue("Old scan")).not.toBeInTheDocument();
  if (action === "mode") expect(view.baseElement.querySelector('input[type="file"]')).not.toBeDisabled();
});

it("clears extracted sales details when the same modal changes to purchase mode", async () => {
  const { view } = await scan();
  expect(view.getByDisplayValue("Scanned buyer")).toBeInTheDocument();
  view.rerender(<MemoryRouter><UIProvider><ScanDocModal open onClose={() => {}} mode="purchase" /></UIProvider></MemoryRouter>);
  expect(view.queryByDisplayValue("Scanned buyer")).not.toBeInTheDocument();
  expect(view.baseElement.querySelector('input[type="file"]')).not.toBeDisabled();
});
