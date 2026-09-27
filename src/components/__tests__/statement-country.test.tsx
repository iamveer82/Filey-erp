import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { statementTemplates, type StatementData } from "../statements/StatementTemplates";

it("uses the company and recipient countries in all statement layouts without relabeling ledger currency", () => {
  const data: StatementData = {
    company: { name: "India company", country_code: "IN", trn: "COMPANY-ID" },
    party: { kind: "customer", name: "UAE customer", country_code: "AE", trn: "PARTY-ID" },
    currency: "AED", period: { from: "2026-09-01", to: "2026-09-27" },
    openingBalance: 0, totalDebit: 118, totalCredit: 0, closingBalance: 118,
    totalVat: 18, totalNet: 100, generatedOn: "2026-09-27",
    lines: [{ date: "2026-09-27", ref: "FIXTURE", description: "Test", debit: 118, credit: 0, balance: 118, vat: 18, net: 100 }],
  };
  for (const { Component } of Object.values(statementTemplates)) {
    const html = renderToStaticMarkup(<Component data={data} />);
    expect(html).toContain("GST");
    if (html.includes("COMPANY-ID")) expect(html).toContain("GSTIN");
    if (html.includes("PARTY-ID")) expect(html).toContain("TRN");
    expect(html).toContain("AED");
    expect(html).not.toContain("Total VAT");
    expect(html).not.toContain("INR");
  }
});
