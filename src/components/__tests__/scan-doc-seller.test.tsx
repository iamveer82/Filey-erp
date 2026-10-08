import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { billing, setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import ScanDocModal from "../ScanDocModal";

vi.mock("../../lib/ai", () => ({ aiReady: () => true, extractInvoiceFromImage: async () => ({
  customer_name: "Scanned buyer", seller_name: "Scanned supplier", currency: "AED", items: [{ description: "Goods", qty: 2, unit_price: 50 }],
}) }));
vi.mock("../../lib/docScan", () => ({ fileToImages: async () => ["data:image/png;base64,fixture"] }));

beforeEach(() => {
  localStorage.clear(); setDataMode("local"); setCacheOrg("scan-org", "scan-user");
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
