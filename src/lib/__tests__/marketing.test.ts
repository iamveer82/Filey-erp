import { describe, it, expect } from "vitest";
import {
  buildLeads,
  leadStats,
  findDuplicates,
  leadsToCsvRows,
  HOT_SCORE,
} from "../marketing";
import { companyDomainFromEmail } from "../scout";
import type { CrmCustomer, InvoiceDocSummary } from "../api";

const TODAY = "2026-08-02";

const customer = (over: Partial<CrmCustomer> & { id: number; name: string }) =>
  ({ created_at: "2026-01-01", ...over }) as CrmCustomer;

const invoice = (over: Partial<InvoiceDocSummary>) =>
  ({
    id: 1,
    number: "INV-1",
    customer_name: "",
    status: "paid",
    template: "minimal",
    total: 0,
    updated_at: TODAY,
    ...over,
  }) as InvoiceDocSummary;

describe("companyDomainFromEmail", () => {
  it("takes the domain off a work address", () => {
    expect(companyDomainFromEmail("Sales@Acme.AE")).toBe("acme.ae");
  });

  it("returns null for personal mailboxes — gmail.com is not their website", () => {
    for (const e of ["a@gmail.com", "b@outlook.com", "c@yahoo.com", "d@icloud.com"])
      expect(companyDomainFromEmail(e)).toBeNull();
  });

  it("returns null for anything unparseable", () => {
    for (const e of ["", "not-an-email", "a@b", "a@@b.com", undefined, null])
      expect(companyDomainFromEmail(e)).toBeNull();
  });
});

describe("buildLeads", () => {
  const customers = [
    customer({
      id: 1,
      name: "Acme Trading",
      email: "sales@acme.ae",
      phone: "0501",
      trn: "1",
    }),
    customer({ id: 2, name: "Quiet Co", email: "info@quiet.ae" }),
    customer({ id: 3, name: "Nobody" }),
  ];
  const invoices = [
    invoice({ customer_name: "Acme Trading", total: 60_000, issue_date: "2026-07-30" }),
    invoice({ customer_name: "Acme Trading", total: 50_000, issue_date: "2026-07-01" }),
    invoice({ customer_name: "Acme Trading", total: 20_000, issue_date: "2026-06-01" }),
    invoice({ customer_name: "Quiet Co", total: 900, issue_date: "2024-01-01" }),
    // Drafts are not trading history — they were never sent.
    invoice({
      customer_name: "Nobody",
      total: 999_999,
      status: "draft",
      issue_date: TODAY,
    }),
  ];

  it("ranks the active paying customer first and the empty record last", () => {
    const leads = buildLeads(customers, invoices, TODAY);
    expect(leads.map((l) => l.customer.name)).toEqual([
      "Acme Trading",
      "Quiet Co",
      "Nobody",
    ]);
    expect(leads[0].score).toBeGreaterThanOrEqual(HOT_SCORE);
  });

  it("aggregates revenue, count and recency per customer", () => {
    const acme = buildLeads(customers, invoices, TODAY)[0];
    expect(acme.invoices).toBe(3);
    expect(acme.revenue).toBe(130_000);
    expect(acme.daysSinceActivity).toBe(3); // 30 Jul → 2 Aug
  });

  it("ignores drafts entirely", () => {
    const nobody = buildLeads(customers, invoices, TODAY).find(
      (l) => l.customer.name === "Nobody"
    )!;
    expect(nobody.invoices).toBe(0);
    expect(nobody.revenue).toBe(0);
    expect(nobody.daysSinceActivity).toBeNull();
  });

  it("counts an overdue balance rather than silently dropping it", () => {
    const leads = buildLeads(
      [customers[0]],
      [
        invoice({
          customer_name: "Acme Trading",
          total: 5000,
          balance: 5000,
          status: "sent",
          issue_date: "2026-05-01",
          due_date: "2026-06-01", // before TODAY
        }),
      ],
      TODAY
    );
    expect(leads[0].overdue).toBe(5000);
    expect(leads[0].reasons.join(" ")).toMatch(/overdue/i);
  });

  it("matches invoices to customers case- and whitespace-insensitively", () => {
    const leads = buildLeads(
      [customer({ id: 1, name: "Acme Trading" })],
      [invoice({ customer_name: "  acme trading ", total: 1000, issue_date: TODAY })],
      TODAY
    );
    expect(leads[0].invoices).toBe(1);
  });

  it("flags who can be enriched: a work domain and something still missing", () => {
    const leads = buildLeads(customers, invoices, TODAY);
    const byName = Object.fromEntries(leads.map((l) => [l.customer.name, l]));
    expect(byName["Acme Trading"].domain).toBe("acme.ae");
    expect(byName["Acme Trading"].incomplete).toBe(false); // has email + phone
    expect(byName["Quiet Co"].domain).toBe("quiet.ae");
    expect(byName["Quiet Co"].incomplete).toBe(true); // no phone
    expect(byName["Nobody"].domain).toBeNull();

    const stats = leadStats(leads);
    expect(stats.total).toBe(3);
    expect(stats.incomplete).toBe(2); // Quiet Co + Nobody
    expect(stats.enrichable).toBe(1); // only Quiet Co has a domain AND a gap
  });

  it("orders ties by revenue, then name, so the list does not shuffle", () => {
    const a = customer({ id: 1, name: "Bravo", email: "b@b.ae", phone: "1" });
    const b = customer({ id: 2, name: "Alpha", email: "a@a.ae", phone: "1" });
    const leads = buildLeads([a, b], [], TODAY);
    expect(leads.map((l) => l.customer.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("findDuplicates", () => {
  const leads = (cs: Partial<CrmCustomer>[]) =>
    buildLeads(
      cs.map((c, i) => customer({ id: i + 1, name: "X", ...c } as any)),
      [],
      TODAY
    );

  it("groups records sharing an email address", () => {
    const groups = findDuplicates(
      leads([
        { id: 1, name: "Acme", email: "same@acme.ae" },
        { id: 2, name: "Acme Dubai", email: "same@acme.ae" },
      ])
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toMatch(/email/i);
    expect(groups[0].leads).toHaveLength(2);
  });

  it("groups records sharing a TRN even when written differently", () => {
    const groups = findDuplicates(
      leads([
        { id: 1, name: "Alpha", trn: "100123456700003" },
        { id: 2, name: "Beta", trn: "100 1234 5670 0003" },
      ])
    );
    expect(groups.some((g) => /TRN/i.test(g.reason))).toBe(true);
  });

  it("sees through company suffixes and punctuation on the name", () => {
    const groups = findDuplicates(
      leads([
        { id: 1, name: "Acme Trading L.L.C." },
        { id: 2, name: "ACME  llc" },
      ])
    );
    expect(groups.some((g) => /name/i.test(g.reason))).toBe(true);
  });

  it("reports a pair once, by the strongest signal", () => {
    // Same email AND same normalised name — should not appear twice.
    const groups = findDuplicates(
      leads([
        { id: 1, name: "Acme LLC", email: "a@acme.ae" },
        { id: 2, name: "Acme", email: "a@acme.ae" },
      ])
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toMatch(/email/i);
  });

  it("does not group distinct businesses", () => {
    expect(
      findDuplicates(
        leads([
          { id: 1, name: "Acme", email: "a@acme.ae" },
          { id: 2, name: "Globex", email: "g@globex.ae" },
        ])
      )
    ).toEqual([]);
  });
});

describe("leadsToCsvRows", () => {
  it("exports the columns a spreadsheet needs, with blanks not undefined", () => {
    const rows = leadsToCsvRows(
      buildLeads([customer({ id: 1, name: "Acme", email: "a@acme.ae" })], [], TODAY)
    );
    expect(rows[0].Name).toBe("Acme");
    expect(rows[0].Domain).toBe("acme.ae");
    expect(rows[0].Phone).toBe("");
    expect(Object.values(rows[0]).every((v) => typeof v === "string")).toBe(true);
  });
});
