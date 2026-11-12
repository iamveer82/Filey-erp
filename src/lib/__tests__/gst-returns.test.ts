import { describe, expect, it } from "vitest";
import type { InvoiceDoc } from "../api";
import { buildGstr1, buildGstr3b, countsForGst, gstr1Json, summarizeGstDoc, uqcFor } from "../gstReturns";

const company = { country_subdivision: "Maharashtra", trn: "27AAPFU0939F1ZV" };
const doc = (over: Partial<InvoiceDoc> & Record<string, unknown>): InvoiceDoc => ({
  id: 1, number: "INV-1", status: "sent", template: "minimal", accent: "#000", currency: "INR", issue_date: "2026-10-05",
  tax_rate: 18, discount: 0, customer_name: "Buyer", items: [{ description: "Engine oil", qty: 10, unit_price: 100, unit: "ltr", custom: { hsn: "2710" } }],
  ...over,
} as unknown as InvoiceDoc);

describe("GST returns", () => {
  const b2b = summarizeGstDoc(doc({ number: "INV-1", customer_trn: "27AAPFU0939F1ZV", buyer_country_subdivision: "Maharashtra" }), company);
  const b2cl = summarizeGstDoc(doc({ number: "INV-2", buyer_country_subdivision: "Karnataka", items: [{ description: "Machine", qty: 1, unit_price: 150000, custom: { hsn: "8479" } }] }), company);
  const b2cs = summarizeGstDoc(doc({ number: "INV-3", buyer_country_subdivision: "Maharashtra", discount: 100 }), company);
  const exported = summarizeGstDoc(doc({ number: "INV-4", buyer_country_code: "AE", tax_rate: 0, items: [{ description: "Oil export", qty: 5, unit_price: 200, custom: { hsn: "2710" } }] }), company);
  const credit = summarizeGstDoc(doc({ number: "CN-1", invoice_type_code: "381", customer_trn: "27AAPFU0939F1ZV", buyer_country_subdivision: "Maharashtra", items: [{ description: "Engine oil", qty: 1, unit_price: 100, unit: "ltr", custom: { hsn: "2710" } }] }), company);

  it("splits each invoice into CGST + SGST or IGST and keeps its HSN lines", () => {
    expect(b2b.rates).toEqual([{ rate: 18, taxable: 1000, igst: 0, cgst: 90, sgst: 90 }]);
    expect(b2b.value).toBe(1180);
    expect(b2b.pos).toBe("27");
    expect(b2cl.rates[0]).toMatchObject({ igst: 27000, cgst: 0 });
    expect(b2cs.rates[0].taxable).toBe(900); // the document discount comes off the taxable value
    expect(b2cs.hsn[0]).toMatchObject({ hsn: "2710", uqc: "LTR", qty: 10, amounts: { taxable: 900 } });
    expect(exported.pos).toBe("96");
    expect(exported.nil).toBe(1000);
  });

  it("sorts invoices into GSTR-1 sections and nets credit notes out of the HSN summary", () => {
    const r1 = buildGstr1([b2b, b2cl, b2cs, exported, credit]);
    expect(r1.b2b.map((d) => d.number)).toEqual(["INV-1"]);
    expect(r1.b2cl.map((d) => d.number)).toEqual(["INV-2"]);
    expect(r1.exports.map((d) => d.number)).toEqual(["INV-4"]);
    expect(r1.b2cs).toEqual([{ type: "INTRA", pos: "27", rate: 18, amounts: { taxable: 900, igst: 0, cgst: 81, sgst: 81 } }]);
    expect(r1.cdnr.map((d) => d.number)).toEqual(["CN-1"]);
    const oil = r1.hsn.find((line) => line.hsn === "2710" && line.rate === 18)!;
    expect(oil.qty).toBe(19); // 10 + 10 - 1 returned
    expect(oil.amounts.taxable).toBe(1800);
  });

  it("computes GSTR-3B output tax, input credit from purchases and the cash payable", () => {
    const purchase = summarizeGstDoc(doc({ number: "PINV-1", customer_trn: "27AAPFU0939F1ZV", buyer_country_subdivision: "Maharashtra",
      items: [{ description: "Base oil", qty: 1, unit_price: 500, custom: { hsn: "2710" } }] }), company, true);
    const r3b = buildGstr3b([b2b, b2cl, b2cs, exported, credit], [purchase]);
    expect(r3b.outward).toEqual({ taxable: 151800, igst: 27000, cgst: 162, sgst: 162 }); // 1000 + 150000 + 900 - 100 credit
    expect(r3b.itc).toEqual({ taxable: 500, igst: 0, cgst: 45, sgst: 45 });
    expect(r3b.payable).toEqual({ igst: 27000, cgst: 117, sgst: 117 });
    expect(r3b.nil).toBe(1000);
  });

  it("flags what would make a return wrong, and skips drafts and cancelled invoices", () => {
    const unknown = summarizeGstDoc(doc({ number: "INV-9", customer_trn: "27AAPFU0939F1ZX", items: [{ description: "No code", qty: 1, unit_price: 10 }] }), { country_subdivision: "" });
    expect(unknown.problems.join(" ")).toMatch(/check digit/);
    expect(unknown.problems.join(" ")).toMatch(/State unknown/);
    expect(unknown.problems.join(" ")).toMatch(/No HSN/);
    expect(countsForGst("draft")).toBe(false);
    expect(countsForGst("Cancelled")).toBe(false);
    expect(countsForGst("paid")).toBe(true);
    expect(uqcFor("Kg")).toBe("KGS");
  });

  it("writes the GSTR-1 JSON the offline tool reads", () => {
    const json = gstr1Json(buildGstr1([b2b, b2cl, b2cs, credit]), company.trn, "2026-10");
    expect(json.fp).toBe("102026");
    expect(json.b2b[0]).toMatchObject({ ctin: "27AAPFU0939F1ZV", inv: [{ inum: "INV-1", idt: "05-10-2026", val: 1180, pos: "27", itms: [{ num: 1, itm_det: { txval: 1000, rt: 18, camt: 90, samt: 90 } }] }] });
    expect(json.b2cl[0].pos).toBe("29");
    expect(json.b2cs[0]).toMatchObject({ sply_ty: "INTRA", pos: "27", typ: "OE", txval: 900 });
    expect(json.cdnr[0].nt[0]).toMatchObject({ ntty: "C", nt_num: "CN-1" });
    expect(json.hsn.data.length).toBeGreaterThan(0);
  });
});
