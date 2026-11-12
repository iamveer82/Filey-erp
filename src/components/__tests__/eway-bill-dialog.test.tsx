import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EwayBillDialog from "../EwayBillDialog";
import { downloadText } from "../../lib/localPaths";

vi.mock("../../lib/localPaths", () => ({ downloadText: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const form = {
  number: "INV-EW-7", issue_date: "2026-10-05", currency: "INR", tax_rate: 18,
  seller_name: "Seller Pvt Ltd", seller_trn: "27AAPFU0939F1ZV", seller_country_subdivision: "Maharashtra", seller_address: "Dock Road, Mumbai 400001",
  customer_name: "Buyer Co", customer_address: "MG Road, Pune 411001", buyer_country_code: "IN", buyer_country_subdivision: "Maharashtra",
  items: [{ description: "Engine oil 5L", qty: 100, unit: "can", unit_price: 1000, custom: { hsn: "2710" } }],
};

it("asks for what the portal needs, then saves the e-way bill JSON", async () => {
  render(<EwayBillDialog open onClose={() => {}} form={form} />);
  expect(screen.getByText(/an e-way bill is required/)).toBeInTheDocument();
  expect(screen.getByLabelText("Dispatch PIN code")).toHaveValue("400001");
  expect(screen.getByLabelText("Delivery PIN code")).toHaveValue("411001");
  const download = screen.getByRole("button", { name: "Download JSON" });
  expect(download).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/distance/);
  fireEvent.change(screen.getByLabelText("Distance (km)"), { target: { value: "150" } });
  fireEvent.change(screen.getByLabelText("Vehicle number"), { target: { value: "MH12AB1234" } });
  expect(download).toBeEnabled();
  fireEvent.click(download);
  await waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
  const [name, text] = vi.mocked(downloadText).mock.calls[0];
  expect(name).toBe("EWB_INV-EW-7.json");
  expect(JSON.parse(text).billLists[0]).toMatchObject({ docNo: "INV-EW-7", cgstValue: 9000, sgstValue: 9000, igstValue: 0, vehicleNo: "MH12AB1234", transDistance: "150" });
});
