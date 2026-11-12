import { describe, expect, it } from "vitest";
import { gstinError, gstState, gstSupply, gstTaxRows, placeOfSupplyLabel, stateFromGstin } from "../gst";
import { amountInWords, indianNumberToWords } from "../words";

describe("India GST", () => {
  it("checks a GSTIN's format, state code and check digit", () => {
    expect(gstinError("27AAPFU0939F1ZV")).toBe("");
    expect(gstinError("27AAPFU0939F1ZX")).toMatch(/check digit/);
    expect(gstinError("99AAPFU0939F1ZV")).toMatch(/state code/);
    expect(gstinError("27AAPFU0939")).toMatch(/15 characters/);
    expect(stateFromGstin("27AAPFU0939F1ZV")?.name).toBe("Maharashtra");
  });

  it("reads a state from its name, old name or code", () => {
    expect(gstState("maharashtra")?.code).toBe("27");
    expect(gstState("Orissa")?.code).toBe("21");
    expect(gstState("27-Maharashtra")?.name).toBe("Maharashtra");
    expect(gstState("Andaman & Nicobar Islands")?.code).toBe("35");
    expect(gstState("Atlantis")).toBeUndefined();
  });

  it("splits intra-state tax into CGST + SGST, and UTGST in a Union territory", () => {
    const intra = gstSupply({ taxCountry: "IN", sellerState: "Maharashtra", buyerGstin: "27AAPFU0939F1ZV" });
    expect(gstTaxRows(180.05, 18, intra)).toEqual([{ label: "CGST (9%)", amount: 90.03 }, { label: "SGST (9%)", amount: 90.02 }]);
    const ut = gstSupply({ taxCountry: "IN", sellerState: "Chandigarh", buyerState: "Chandigarh" });
    expect(gstTaxRows(50, 5, ut).map(r => r.label)).toEqual(["CGST (2.5%)", "UTGST (2.5%)"]);
  });

  it("charges IGST between states and on exports, and leaves unknown states unsplit", () => {
    const inter = gstSupply({ taxCountry: "IN", sellerState: "Maharashtra", buyerState: "Karnataka" });
    expect(gstTaxRows(180, 18, inter)).toEqual([{ label: "IGST (18%)", amount: 180 }]);
    expect(placeOfSupplyLabel(inter)).toBe("Karnataka (29)");
    const exported = gstSupply({ taxCountry: "IN", sellerState: "Maharashtra", buyerCountry: "AE" });
    expect(placeOfSupplyLabel(exported)).toBe("Outside India (96)");
    expect(gstSupply({ taxCountry: "IN", sellerState: "Maharashtra" })).toBeUndefined();
    expect(gstSupply({ taxCountry: "AE", sellerState: "Maharashtra", buyerState: "Maharashtra" })).toBeUndefined();
    expect(gstTaxRows(180, 18, undefined)).toEqual([{ label: "GST (18%)", amount: 180 }]);
  });

  it("writes rupees in lakh and crore", () => {
    expect(indianNumberToWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
    expect(amountInWords(150000.5, "INR")).toBe("Indian Rupees One Lakh Fifty Thousand and Paise Fifty Only");
    expect(amountInWords(1500000, "AED")).toBe("UAE Dirhams One Million Five Hundred Thousand Only");
  });
});
