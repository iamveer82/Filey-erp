import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { DOC_TEMPLATES } from "../DocTemplates";
import { checkFreeInvoiceCap, clearEntitlementCache, entitlement, FREE_LIMITS } from "../../lib/license";

const cloud = vi.hoisted(() => ({
  plan: "free", status: "active", ownerLicensed: false,
  rpc: vi.fn(), read: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: cloud.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: cloud.read }) }) }),
  },
}));

const form: DocViewForm = {
  number: "LOCAL-001", currency: "AED", seller_name: "Local Company",
  customer_name: "Customer", issue_date: "2026-10-04", tax_rate: 5,
  items: [{ description: "Local service", qty: 2, unit_price: 100, unit: "hr" }],
};

beforeEach(() => {
  localStorage.clear();
  clearEntitlementCache();
  cloud.plan = "free"; cloud.status = "active"; cloud.ownerLicensed = false;
  cloud.rpc.mockReset().mockImplementation(async (name) => ({
    data: name === "current_org" ? "org" : cloud.ownerLicensed, error: null,
  }));
  cloud.read.mockReset().mockImplementation(async () => ({
    data: { plan: cloud.plan, plan_status: cloud.status }, error: null,
  }));
});

describe("free device documents", () => {
  it.each(DOC_TEMPLATES)("renders $id without plan branding or network lookup", ({ id }) => {
    localStorage.setItem("filey_data_mode", "local");
    const html = renderToStaticMarkup(<DocView form={{ ...form, template: id }} />);
    expect(html).toContain("LOCAL-001");
    expect(html).toContain("Local Company");
    expect(html).not.toContain("Made with Filey");
    expect(cloud.rpc).not.toHaveBeenCalled();
    expect(cloud.read).not.toHaveBeenCalled();
  });

  it("saves local invoices without counting or checking a paid entitlement", async () => {
    localStorage.setItem("filey_data_mode", "local");
    const count = vi.fn(async () => 100_000);
    await expect(checkFreeInvoiceCap(count)).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
    expect(cloud.rpc).not.toHaveBeenCalled();
  });

  it.each(["minimal", "corporate", "uae-full", "uae-receipt-voucher"])("retains hosted Basic branding for %s", async (template) => {
    localStorage.setItem("filey_data_mode", "cloud");
    await entitlement();
    expect(renderToStaticMarkup(<DocView form={{ ...form, template }} />)).toContain("Made with Filey");
  });

  it("retains the hosted Basic invoice quota", async () => {
    localStorage.setItem("filey_data_mode", "cloud");
    const count = vi.fn(async () => FREE_LIMITS.invoicesPerMonth);
    await expect(checkFreeInvoiceCap(count)).rejects.toThrow("Basic plan limit reached");
    expect(count).toHaveBeenCalledOnce();
  });

  it("preserves uncapped paid cloud invoices and unbranded documents", async () => {
    localStorage.setItem("filey_data_mode", "cloud");
    cloud.plan = "pro";
    await entitlement();
    const count = vi.fn(async () => 100_000);
    await expect(checkFreeInvoiceCap(count)).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<DocView form={{ ...form, template: "corporate" }} />)).not.toContain("Made with Filey");
  });
});
