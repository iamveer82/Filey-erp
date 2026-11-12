import { describe, expect, it } from "vitest";
import type { InvoiceDoc } from "../api";
import { ewayBillJson, ewayProblems, pincodeFrom, type EwayTransport } from "../ewayBill";

const doc = {
  id: 1, number: "INV-EW-1", status: "sent", template: "minimal", accent: "#000", currency: "INR", issue_date: "2026-10-05", tax_rate: 18,
  seller_name: "Seller Pvt Ltd", seller_trn: "27AAPFU0939F1ZV", seller_country_subdivision: "Maharashtra", seller_address: "12 Dock Road, Mumbai 400001",
  customer_name: "Buyer Co", customer_address: "5 MG Road, Bengaluru 560001", buyer_country_code: "IN", buyer_country_subdivision: "Karnataka",
  items: [{ description: "Engine oil 5L", qty: 100, unit: "can", unit_price: 1000, custom: { hsn: "2710" } }],
} as unknown as InvoiceDoc;
const transport: EwayTransport = { mode: "1", distance: 980, vehicleNo: "mh 01 ab 1234", transporterId: "", transporterName: "", docNo: "", docDate: "", fromPincode: "400001", toPincode: "560001" };

describe("e-way bill", () => {
  it("finds the PIN code in an address", () => {
    expect(pincodeFrom("12 Dock Road, Mumbai 400001")).toBe("400001");
    expect(pincodeFrom("Phone 9876543210")).toBe("");
  });

  it("writes the NIC bulk JSON with the inter-state IGST split and HSN lines", () => {
    const bill = ewayBillJson(doc, transport).billLists[0];
    expect(bill).toMatchObject({
      userGstin: "27AAPFU0939F1ZV", supplyType: "O", subSupplyType: 1, docType: "INV", docNo: "INV-EW-1", docDate: "05/10/2026",
      fromStateCode: 27, toStateCode: 29, toGstin: "URP", fromPincode: 400001, toPincode: 560001,
      totalValue: 100000, igstValue: 18000, cgstValue: 0, totInvValue: 118000, transMode: 1, transDistance: "980", vehicleNo: "MH01AB1234", vehicleType: "R",
    });
    expect(bill.itemList).toEqual([expect.objectContaining({ itemNo: 1, hsnCode: 2710, quantity: 100, qtyUnit: "CAN", taxableAmount: 100000, igstRate: 18, cgstRate: 0 })]);
  });

  it("says what the portal would reject", () => {
    expect(ewayProblems(doc, transport)).toEqual([]);
    const problems = ewayProblems(doc, { ...transport, vehicleNo: "", toPincode: "56", distance: 0 });
    expect(problems.join(" ")).toMatch(/delivery PIN/);
    expect(problems.join(" ")).toMatch(/distance/);
    expect(problems.join(" ")).toMatch(/vehicle number/);
  });
});
