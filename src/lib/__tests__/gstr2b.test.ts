import { expect, it } from "vitest";
import { invoiceKey, matchGstr2b, parseGstr2b } from "../gstr2b";
import { compositionTax, quarterMonths, type GstDocSummary } from "../gstReturns";
import { gstDocTitle, gstEndorsement } from "../gst";

const SUPPLIER = "27AAPFU0939F1ZV";
const file = {
  chksum: "x",
  data: {
    gstin: "29ABCDE1234F1Z5", rtnprd: "092026",
    docdata: {
      b2b: [{ ctin: SUPPLIER, trdnm: "Oil Traders", inv: [
        { inum: "OT/001", dt: "05-09-2026", val: 1180, itcavl: "Y", items: [{ rt: 18, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0 }] },
        { inum: "OT/002", dt: "12-09-2026", val: 2360, itcavl: "Y", items: [{ rt: 18, txval: 2000, igst: 360, cgst: 0, sgst: 0, cess: 0 }] },
        { inum: "OT/003", dt: "20-09-2026", val: 590, itcavl: "N", items: [{ rt: 18, txval: 500, igst: 90, cgst: 0, sgst: 0, cess: 0 }] },
      ] }],
      cdnr: [{ ctin: SUPPLIER, trdnm: "Oil Traders", nt: [{ ntnum: "CN-1", dt: "25-09-2026", val: 118, typ: "C", items: [{ rt: 18, txval: 100, igst: 18 }] }] }],
    },
  },
};

const books = (number: string, taxable: number, date = "2026-09-05", extra: Partial<GstDocSummary> = {}): GstDocSummary => ({
  number, date, party: "Oil Traders", gstin: SUPPLIER, pos: "29", credit: false, value: taxable * 1.18,
  rates: [{ rate: 18, taxable, igst: taxable * 0.18, cgst: 0, sgst: 0 }], nil: 0, hsn: [], problems: [], ...extra,
});

it("reads invoices and notes from the portal file", () => {
  const parsed = parseGstr2b(file);
  expect(parsed.period).toBe("2026-09");
  expect(parsed.docs).toHaveLength(4);
  expect(parsed.docs[0]).toMatchObject({ gstin: SUPPLIER, number: "OT/001", date: "2026-09-05", taxable: 1000, igst: 180, itc: true });
  expect(parsed.docs[2].itc).toBe(false);
  expect(parsed.docs[3]).toMatchObject({ number: "CN-1", note: "C", taxable: 100 });
  expect(() => parseGstr2b({ hello: 1 })).toThrow("not a GSTR-2B");
});

it("matches by GSTIN and invoice number, however the number is typed", () => {
  expect(invoiceKey("ot / 001")).toBe(invoiceKey("OT-001"));
  expect(invoiceKey("INV-0042")).toBe("INV0042");
  const result = matchGstr2b(parseGstr2b(file).docs, [
    books("ot-001", 1000),
    books("OT/002", 2100, "2026-09-12"),
    books("OT/009", 400, "2026-09-28"),
  ]);
  expect(result.matched.map((p) => p.books.number)).toEqual(["ot-001"]);
  expect(result.mismatched).toHaveLength(1);
  expect(result.mismatched[0]).toMatchObject({ taxableDiff: 100, taxDiff: 18 });
  expect(result.missingInBooks.map((p) => p.number)).toEqual(["OT/003", "CN-1"]);
  expect(result.missingInPortal.map((d) => d.number)).toEqual(["OT/009"]);
});

it("works out composition tax for the quarter", () => {
  expect(quarterMonths("2026-05")).toEqual(["2026-04", "2026-05", "2026-06"]);
  expect(quarterMonths("2027-01")).toEqual(["2027-01", "2027-02", "2027-03"]);
  const sale = (value: number, credit = false) => books("B", 0, "2026-05-01", { value, credit, rates: [], supply: { kind: "intra", state: { code: "27", name: "Maharashtra" }, utgst: false } });
  expect(compositionTax([sale(100000), sale(50000), sale(10000, true)], 1)).toEqual({ turnover: 140000, tax: 1400, cgst: 700, sgst: 700 });
});

it("titles a tax-free domestic invoice a Bill of Supply and endorses exports", () => {
  const intra = { kind: "intra" as const, state: { code: "27", name: "Maharashtra" }, utgst: false };
  const exp = { kind: "inter" as const, export: true };
  expect(gstDocTitle("Tax Invoice", intra, 0, false)).toBe("Bill of Supply");
  expect(gstDocTitle("Tax Invoice", intra, 18, false)).toBe("Tax Invoice");
  expect(gstDocTitle("Proforma", intra, 0, false)).toBe("Proforma");
  expect(gstDocTitle("Tax Invoice", intra, 0, true)).toBe("Tax Invoice");
  expect(gstDocTitle("Tax Invoice", exp, 0, false)).toBe("Tax Invoice");
  expect(gstEndorsement(exp, 0)).toMatch(/letter of undertaking without payment of IGST/);
  expect(gstEndorsement(exp, 50)).toBe("Supply meant for export on payment of IGST");
  expect(gstEndorsement(intra, 0)).toBe("");
});
