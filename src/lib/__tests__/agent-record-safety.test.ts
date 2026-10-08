import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, erp, fin, hr, quotes, pos, crm, suppliers, receipts, setCacheOrg, tools as settings } from "../api";
import { runTool, TOOLS } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
  setAgentMode("auto");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each(["quotation", "purchase_order"] as const)("AI shares a hosted %s link and refuses local publication", async kind => {
  vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.gofiley.com/");
  const source = kind === "quotation" ? quotes : pos;
  if (kind === "quotation") vi.spyOn(quotes, "listDocs").mockResolvedValue([{ id: 8, number: "DOC-8" }] as never);
  else vi.spyOn(pos, "list").mockResolvedValue([{ id: 8, po_number: "DOC-8" }] as never);
  const publish = vi.spyOn(source, "publicLink").mockResolvedValue("share/token");
  const tool = TOOLS.find(candidate => candidate.name === "share_document_link")!;
  await expect(tool.run({ kind, number: "DOC-8" })).rejects.toThrow("Share the PDF");
  expect(publish).not.toHaveBeenCalled();
  setDataMode("cloud");
  expect(await tool.run({ kind, number: "DOC-8" })).toEqual({ url: "https://app.gofiley.com/#/portal/share%2Ftoken", number: "DOC-8" });
  expect(publish).toHaveBeenCalledExactlyOnceWith(8);
});

it("copies saved electronic identities into AI drafts and reports missing details without failing the save", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Seller", currency: "AED", country_code: "AE", address: "Seller street", city: "Dubai",
    country_subdivision: "DXB", trn: "100123456700003", legal_id: "SELLER-TL", legal_id_type: "TL",
    einvoice: { tin: "1001234567", endpoint_id: "1001234567", legal_authority: "Dubai DET" }, default_tax_rate: 5 } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 9, name: "Buyer", phone: " ", phone_e164: "+971500000001", city: "Sharjah", address: "Buyer street", country_code: "AE",
    country_subdivision: "SHJ", trn: "100987654300003", custom_fields: { einvoice_identity: JSON.stringify({ tin: "1009876543", endpoint_id: "1009876543", legal_id: "BUYER-TL" }) } }] as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  const result = await runTool("create_invoice_draft", { invoice_number: "TEST-EINV-1", customer_name: "Buyer",
    items: [{ description: "Service", qty: 1, unit_price: 100, unit: "HUR" }] });
  expect(result).toMatchObject({ ok: true, total: 105, einvoice_review: { status: "needs_details", fields: expect.arrayContaining([
    expect.objectContaining({ field: "payment_means_code" }), expect.objectContaining({ field: "due_date" }),
  ]) } });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toMatchObject({ seller_city: "Dubai", seller_country_subdivision: "DXB", seller_legal_id: "SELLER-TL",
    buyer_city: "Sharjah", buyer_country_subdivision: "SHJ", buyer_country_code: "AE",
    einvoice: { seller: { tin: "1001234567", legal_authority: "Dubai DET" }, buyer: { tin: "1009876543", legal_id: "BUYER-TL", phone: "+971500000001" } } });
});

it("AI purchase drafts retain optional supplier identity and location presets", async () => {
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Our company", country_code: "AE" } as never);
  vi.spyOn(suppliers, "list").mockResolvedValue([{ id: 5, name: "Supplier", address: "Supplier street", tax_id: "100987654300003",
    custom_fields: { city: "Dubai", country_subdivision: "DXB", country_code: "AE", einvoice_identity: JSON.stringify({ tin: "1009876543" }) } }] as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  expect(await runTool("create_purchase_invoice_draft", { supplier_name: "Supplier", items: [{ description: "Goods", qty: 2, unit_price: 50 }] })).toMatchObject({ ok: true });
  expect(save.mock.calls[0][0]).toMatchObject({ doc_type: "purchase", customer_address: "Supplier street", customer_trn: "100987654300003",
    buyer_city: "Dubai", buyer_country_subdivision: "DXB", buyer_country_code: "AE", einvoice: { buyer: { tin: "1009876543" } } });
});

it("a buyer change uses the new saved e-invoice profile and preserves only the seller and document identity", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 1, number: "INV-1", status: "draft", customer_name: "Old Buyer", customer_id: 3,
    currency: "AED", tax_rate: 5, items: [{ description: "Service", qty: 1, unit_price: 100 }],
    einvoice: { uuid: "existing-uuid", seller: { tin: "1001234567" }, buyer: { tin: "1000000000" }, buyer_delivery_mode: "export-unregistered", delivery: { city: "Old" } } } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 9, name: "New Buyer", city: "Abu Dhabi", country_subdivision: "AUH", country_code: "AE",
    custom_fields: { einvoice_identity: JSON.stringify({ tin: "1009876543" }) } }] as never);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "New Buyer" })).toMatchObject({ ok: true });
  expect(save.mock.calls[0][0]).toMatchObject({ buyer_city: "Abu Dhabi", buyer_country_subdivision: "AUH", buyer_country_code: "AE",
    einvoice: { uuid: "existing-uuid", seller: { tin: "1001234567" }, buyer: { tin: "1009876543" }, buyer_delivery_mode: undefined, delivery: undefined } });
});

it("relinks a revised buyer and clears the previous buyer's routing snapshot", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({
    id: 1, number: "INV-1", status: "draft", customer_name: "Old Customer", customer_id: 3,
    customer_email: "old@example.test", customer_address: "Old address", customer_trn: "old-trn",
    buyer_city: "Old city", buyer_country_code: "AE", buyer_country_subdivision: "AE-DU",
    einvoice: { uuid: "existing-uuid", buyer: { endpoint_id: "old-endpoint" }, buyer_delivery_mode: "peppol", delivery: { address: "Old delivery" } },
    tax_rate: 5, discount: 0, items: [{ description: "Service", qty: 1, unit_price: 100, custom: { tax: "5" }, tax_category: "S" }],
  } as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 9, name: "New Customer", email: "new@example.test", address: "New address", tax_id: "new-trn" }] as never);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "New Customer" })).toMatchObject({ ok: true });
  expect(save.mock.calls[0][0]).toMatchObject({
    customer_id: 9, customer_email: "new@example.test", customer_address: "New address", customer_trn: "new-trn",
    buyer_city: "", buyer_country_code: "", einvoice: { uuid: "existing-uuid", buyer: undefined, buyer_delivery_mode: undefined, delivery: undefined },
  });
  expect(save.mock.calls[0][0].items[0]).toMatchObject({ custom: { tax: "5" }, tax_category: "S" });
  await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "Unsaved Customer" });
  expect(save.mock.calls[1][0]).toMatchObject({ customer_id: null, customer_email: "", customer_address: "", customer_trn: "" });
});

it("keeps the saved buyer on line edits and reports persisted manual and discounted calculations", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 1, number: "INV-1", status: "draft", customer_id: 3, customer_name: "Mary", tax_rate: 5, discount: 0, items: [] } as never);
  const parties = vi.spyOn(crm, "customers").mockResolvedValue([{ id: 2, name: "Mary" }, { id: 3, name: "Mary" }] as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  const result = await runTool("revise_invoice", { invoice_number: "INV-1", customer_id: 3,
    custom_columns: [{ key: "liters", label: "Litres" }], price_by: "liters",
    items: [
      { description: "Manual", qty: 2, unit_price: 1, custom: { __calc_mode: "manual", __manual_amount: "500" } },
      { description: "Measured", qty: 1, unit_price: 4, custom: { liters: "400", __disc_pct: "10" } },
    ] });
  expect(result).toMatchObject({ ok: true, lines: [{ amount: 500 }, { amount: 1440 }], subtotal: 2100, discount: 160, tax: 97, total: 2037 });
  expect(save.mock.calls[0][0]).toMatchObject({ customer_id: 3, customer_name: "Mary" });
  expect(parties).not.toHaveBeenCalled();
});

it("rejects unknown pricing columns and malformed operands before any document write", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 1, number: "INV-1", status: "draft", customer_name: "Mary", tax_rate: 0, discount: 0, items: [] } as never);
  vi.spyOn(billing, "getCompany").mockResolvedValue({} as never);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  vi.spyOn(suppliers, "list").mockResolvedValue([]);
  vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  vi.spyOn(pos, "list").mockResolvedValue([]);
  const writes = [vi.spyOn(billing, "saveDoc"), vi.spyOn(quotes, "saveDoc"), vi.spyOn(pos, "save")];
  for (const name of ["create_invoice_draft", "revise_invoice", "create_quote", "create_purchase_order"]) {
    for (const invalid of [{ price_by: "missing", custom: { liters: "400" } },
      { price_by: "liters", custom: {} }, { price_by: "liters", custom: { liters: "400L" } },
      { price_by: "liters", custom: { __calc_mode: "manual", __manual_amount: "abc" } },
      { price_by: "liters", custom: { liters: "400", __disc_pct: "101" } }]) {
      const result = await runTool(name, { invoice_number: "INV-1", customer_name: "Mary", supplier_name: "Mark",
        custom_columns: [{ key: "liters", label: "Litres" }], price_by: invalid.price_by,
        items: [{ description: "Oil", qty: 20, ...(name === "create_quote" ? { rate: 4 } : { unit_price: 4 }), custom: invalid.custom }] });
      expect(result, name).toHaveProperty("error");
    }
  }
  for (const write of writes) expect(write).not.toHaveBeenCalled();
});

it("validates replacement invoice lines and preserves supplied product and VAT metadata", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 1, number: "INV-1", status: "draft", customer_name: "Mark", items: [{ description: "Service", qty: 1, unit_price: 100 }] } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([{ id: 2, name: "Consulting", sku: "SVC" }] as never);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  for (const changes of [{ qty: 0 }, { qty: -1 }, { unit_price: -1 }, { description: " " }]) {
    expect(await runTool("revise_invoice", { invoice_number: "INV-1", items: [{ description: "Consulting", qty: 2, unit_price: 50, ...changes }] })).toHaveProperty("error");
  }
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", items: [] })).toHaveProperty("error");
  expect(save).not.toHaveBeenCalled();
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", items: [{ description: "Consulting", product_id: 2, qty: 2, unit_price: 50, tax_category: "E", custom: { tax: "0", tax_exemption_reason: "Exempt supply" } }] })).toMatchObject({ ok: true });
  expect(save.mock.calls[0][0].items[0]).toMatchObject({ product_id: 2, qty: 2, unit_price: 50, tax_category: "E", custom: { tax: "0", tax_exemption_reason: "Exempt supply" } });
});

it("refuses duplicate saved customer names before revising a document", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1", status: "draft" }] as never);
  vi.spyOn(billing, "getDoc").mockResolvedValue({ id: 1, number: "INV-1", status: "draft", customer_name: "Mark", items: [{ description: "Service", qty: 1, unit_price: 100 }] } as never);
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 2, name: "Mary" }, { id: 3, name: "Mary" }] as never);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  const save = vi.spyOn(billing, "saveDoc").mockResolvedValue(1 as never);
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "Mary" })).toMatchObject({ error: expect.stringContaining("More than one customer") });
  expect(save).not.toHaveBeenCalled();
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "Mary", customer_id: 3 })).toMatchObject({ ok: true });
  expect(save.mock.calls[0][0]).toMatchObject({ customer_name: "Mary", customer_id: 3 });
  expect(await runTool("revise_invoice", { invoice_number: "INV-1", customer_name: "Wrong name", customer_id: 3 })).toHaveProperty("error");
  expect(save).toHaveBeenCalledTimes(1);
});

it("resolves employee names uniquely for both payroll and attendance", async () => {
  const employees = vi.spyOn(hr, "employees").mockResolvedValue([
    { id: 1, name: "Ravi Kumar" },
    { id: 2, name: "Ravi Sharma" },
  ] as never);
  const payroll = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const attendance = vi.spyOn(hr, "markAttendance").mockResolvedValue(1);
  for (const tool of ["run_payroll", "mark_attendance"]) {
    expect(
      await runTool(
        tool,
        { employee_name: "Ravi", period: "2026-09", basic: 100, status: "present" },
        () => true
      )
    ).toMatchObject({ error: expect.stringMatching(/More than one employee/) });
  }
  expect(payroll).not.toHaveBeenCalled();
  expect(attendance).not.toHaveBeenCalled();
  await runTool(
    "run_payroll",
    { employee_name: "id:2", period: "2026-09", basic: 100 },
    () => true
  );
  await runTool(
    "mark_attendance",
    { employee_name: " Ravi Kumar ", date: "2026-09-08", status: "present" },
    () => true
  );
  expect(payroll).toHaveBeenCalledExactlyOnceWith(2, "2026-09", 100, 0, 0);
  expect(attendance).toHaveBeenCalledExactlyOnceWith(1, "2026-09-08", "present");
  employees.mockResolvedValue([
    { id: 1, name: "Ravi Kumar" },
    { id: 2, name: "Ravi Kumar" },
  ] as never);
  expect(
    await runTool(
      "run_payroll",
      { employee_name: "Ravi Kumar", period: "2026-09", basic: 100 },
      () => true
    )
  ).toHaveProperty("error");
  expect(payroll).toHaveBeenCalledTimes(1);
});

it("rejects malformed attendance dates/status and pay amounts before employee writes", async () => {
  vi.spyOn(hr, "employees").mockResolvedValue([{ id: 1, name: "Ravi" }] as never);
  const payroll = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const attendance = vi.spyOn(hr, "markAttendance").mockResolvedValue(1);
  for (const args of [
    { basic: "one hundred" },
    { basic: null },
    { basic: -1 },
    { allowances: Infinity },
    { deductions: "unknown" },
  ]) {
    expect(
      await runTool(
        "run_payroll",
        { employee_name: "Ravi", basic: 100, period: "2026-09", ...args },
        () => true
      )
    ).toHaveProperty("error");
  }
  for (const args of [
    { status: "working" },
    { date: "2026-02-31" },
    { date: "yesterday" },
  ]) {
    expect(
      await runTool(
        "mark_attendance",
        { employee_name: "Ravi", status: "present", ...args },
        () => true
      )
    ).toHaveProperty("error");
  }
  expect(payroll).not.toHaveBeenCalled();
  expect(attendance).not.toHaveBeenCalled();
});

it("refuses ambiguous invoice numbers across all invoice actions before changing or sending", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([
    { id: 1, number: "INV-100", status: "draft" },
    { id: 2, number: "INV-101", status: "draft" },
  ] as never);
  const status = vi.spyOn(billing, "setStatus").mockResolvedValue();
  const doc = vi.spyOn(billing, "getDoc");
  const actions = [
    "revise_invoice",
    "send_invoice",
    "mark_invoice_paid",
    "set_recurring",
    "email_invoice",
    "send_invoice_whatsapp",
    "prepare_invoice_whatsapp",
    "set_invoice_template",
    "share_document_link",
  ];
  for (const name of actions) {
    const result = await runTool(
      name,
      name === "share_document_link"
        ? { number: "INV-10", kind: "invoice" }
        : { invoice_number: "INV-10", ...(name === "set_invoice_template" ? { template: "minimal" } : {}) },
      () => true,
      true
    );
    expect(result, name).toMatchObject({
      error: expect.stringMatching(/More than one invoice.*id:1.*id:2/),
    });
  }
  expect(status).not.toHaveBeenCalled();
  expect(doc).not.toHaveBeenCalled();
  await runTool("send_invoice", { invoice_number: " INV-100 " }, () => true, true);
  expect(status).toHaveBeenCalledExactlyOnceWith(1, "sent");
});

it("resolves duplicate invoice numbers only when an explicit ID is supplied", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([
    { id: 1, number: "INV-1" },
    { id: 2, number: "INV-1" },
  ] as never);
  const status = vi.spyOn(billing, "setStatus").mockResolvedValue();
  expect(
    await runTool("mark_invoice_paid", { invoice_number: "INV-1" }, () => true)
  ).toHaveProperty("error");
  expect(status).not.toHaveBeenCalled();
  await runTool("mark_invoice_paid", { invoice_number: "id:2" }, () => true);
  expect(status).toHaveBeenCalledExactlyOnceWith(2, "paid");
});

it("also refuses ambiguous quotation and purchase order links", async () => {
  vi.spyOn(quotes, "listDocs").mockResolvedValue([
    { id: 1, number: "Q-10" },
    { id: 2, number: "Q-11" },
  ] as never);
  vi.spyOn(pos, "list").mockResolvedValue([
    { id: 1, po_number: "PO-10" },
    { id: 2, po_number: "PO-11" },
  ] as never);
  const quoteLink = vi.spyOn(quotes, "publicLink");
  const poLink = vi.spyOn(pos, "publicLink");
  expect(
    await runTool("share_document_link", { kind: "quotation", number: "Q-1" }, () => true)
  ).toHaveProperty("error");
  expect(
    await runTool(
      "share_document_link",
      { kind: "purchase_order", number: "PO-1" },
      () => true
    )
  ).toHaveProperty("error");
  expect(quoteLink).not.toHaveBeenCalled();
  expect(poLink).not.toHaveBeenCalled();
});

it("rejects ambiguous products and invalid quantities without adjusting stock", async () => {
  vi.spyOn(erp, "products").mockResolvedValue([
    { id: 1, name: "Bolt small", sku: "BOLT-S", quantity: 10 },
    { id: 2, name: "Bolt large", sku: "BOLT-L", quantity: 20 },
  ] as never);
  const stock = vi.spyOn(erp, "updateStock").mockResolvedValue();
  expect(
    await runTool("adjust_stock", { product: "Bolt", delta: -1 }, () => true)
  ).toMatchObject({ error: expect.stringMatching(/More than one product/) });
  for (const args of [
    {},
    { set: "many" },
    { set: null },
    { set: -1 },
    { set: Infinity },
    { delta: NaN },
    { set: 3, delta: 1 },
    { delta: -30 },
  ]) {
    expect(
      await runTool("adjust_stock", { product: "BOLT-L", ...args }, () => true)
    ).toHaveProperty("error");
  }
  expect(stock).not.toHaveBeenCalled();
  expect(
    await runTool("adjust_stock", { product: "BOLT-L", set: 20 }, () => true)
  ).toMatchObject({ ok: true, changed: false });
  expect(stock).not.toHaveBeenCalled();
  expect(
    await runTool("adjust_stock", { product: "BOLT-L", set: 12 }, () => true)
  ).toMatchObject({ ok: true, changed: true, product_id: 2, delta: -8 });
  expect(stock).toHaveBeenCalledExactlyOnceWith(2, -8);
});

it("does not report missing records when the lookup actually failed", async () => {
  vi.spyOn(billing, "listDocs").mockRejectedValue(
    new Error("Invoice storage unavailable")
  );
  vi.spyOn(erp, "products").mockRejectedValue(new Error("Inventory storage unavailable"));
  expect(await runTool("send_invoice", { invoice_number: "INV-1" }, () => true)).toEqual({
    error: "Invoice storage unavailable", retry_safe: false,
  });
  expect(
    await runTool("adjust_stock", { product: "BOLT-L", delta: 1 }, () => true)
  ).toEqual({ error: "Inventory storage unavailable", retry_safe: false });
});

it.each(["workspace", "workspace_return", "cancel"] as const)("prevents multi-step record mutations after a %s change", async reason => {
  let controller = new AbortController();
  const change = () => {
    if (reason === "cancel") { controller.abort(); return; }
    setCacheOrg("other-org", "other-user");
    if (reason === "workspace_return") setCacheOrg("test-org", "test-user");
  };
  vi.spyOn(crm, "customers").mockResolvedValue([]);
  vi.spyOn(erp, "products").mockResolvedValue([]);
  const companyFixture = { name: "Fixture", default_accent: "#111111", default_template: "minimal" };
  const company = vi.spyOn(billing, "getCompany").mockResolvedValue(companyFixture);
  const invoices = vi.spyOn(billing, "listDocs").mockResolvedValue([]);
  const quoteList = vi.spyOn(quotes, "listDocs").mockResolvedValue([]);
  const poList = vi.spyOn(pos, "list").mockResolvedValue([]);
  const receiptList = vi.spyOn(receipts, "list").mockResolvedValue([]);
  const staff = vi.spyOn(hr, "employees").mockResolvedValue([]);
  const register = vi.spyOn(settings, "settings").mockResolvedValue([]);
  const saveInvoice = vi.spyOn(billing, "saveDoc").mockResolvedValue(1);
  const saveQuote = vi.spyOn(quotes, "saveDoc").mockResolvedValue(1);
  const savePo = vi.spyOn(pos, "save").mockResolvedValue(1);
  const saveReceipt = vi.spyOn(receipts, "save").mockResolvedValue(1);
  const payroll = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const saveRegister = vi.spyOn(settings, "setSetting").mockResolvedValue();
  const cases = [
    { name: "create_invoice_draft", args: { customer_name: "Mark", items: [{ description: "Service", qty: 1, unit_price: 10 }] }, prepare: () => company.mockImplementationOnce(async () => { change(); return companyFixture; }), write: saveInvoice },
    { name: "create_quote", args: { customer_name: "Mark", items: [{ description: "Service", qty: 1, rate: 10 }] }, prepare: () => quoteList.mockImplementationOnce(async () => { change(); return []; }), write: saveQuote },
    { name: "create_purchase_order", args: { supplier_name: "Mark", items: [{ description: "Service", qty: 1, unit_price: 10 }] }, prepare: () => poList.mockImplementationOnce(async () => { change(); return []; }), write: savePo },
    { name: "create_payment_receipt", args: { customer_name: "Mark", amount: 10 }, prepare: () => receiptList.mockImplementationOnce(async () => { change(); return []; }), write: saveReceipt },
    { name: "run_payroll", args: { employee_name: "Mark", basic: 100, period: "2026-09" }, prepare: () => staff.mockImplementationOnce(async () => { change(); return [{ id: 1, name: "Mark" }] as never; }), write: payroll },
    { name: "record_cheque", args: { cheque_no: "1", type: "received", party: "Mark", amount: 10 }, prepare: () => register.mockImplementationOnce(async () => { change(); return []; }), write: saveRegister },
  ];
  vi.spyOn((await import("../api")).suppliers, "list").mockResolvedValue([]);
  for (const item of cases) {
    setCacheOrg("test-org", "test-user");
    // Each task owns a fresh controller; revoking an old task never affects a
    // later legitimate turn, including another channel in this workspace.
    controller = new AbortController();
    item.prepare();
    await expect(runTool(item.name, item.args, () => true, true, undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(item.write, item.name).not.toHaveBeenCalled();
  }
  // A workspace change during company lookup now stops before allocating or
  // looking up a fresh invoice number, as well as before the write.
  expect(invoices).not.toHaveBeenCalled();
});

it.each(["organization", "account"] as const)("does not revive an approved action after switching %s away and back", async kind => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1" }] as never);
  const status = vi.spyOn(billing, "setStatus").mockResolvedValue();
  const approve = vi.fn(async () => {
    setCacheOrg(kind === "organization" ? "other-org" : "test-org", kind === "account" ? "other-user" : "test-user");
    setCacheOrg("test-org", "test-user");
    return true;
  });
  await expect(runTool("mark_invoice_paid", { invoice_number: "INV-1" }, approve, true))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(approve).toHaveBeenCalledOnce();
  expect(status).not.toHaveBeenCalled();
});

it("retains a confirmed in-flight write receipt when Stop arrives before its acknowledgement", async () => {
  let started!: () => void, finish!: (id: number) => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const committed = new Promise<number>(resolve => { finish = resolve; });
  const write = vi.spyOn(fin, "createExpense").mockImplementation(() => { started(); return committed; });
  const controller = new AbortController();
  const result = runTool("log_expense", { amount: 20, description: "Fixture expense" }, undefined, true, undefined, controller.signal);
  await dispatched;
  controller.abort();
  finish(42);
  await expect(result).resolves.toMatchObject({ ok: true, id: 42 });
  expect(write).toHaveBeenCalledOnce();
});

it.each(["workspace", "workspace_return", "account_return"] as const)("does not expose an in-flight write receipt after %s", async change => {
  let started!: () => void, finish!: (id: number) => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const committed = new Promise<number>(resolve => { finish = resolve; });
  const write = vi.spyOn(fin, "createExpense").mockImplementation(() => { started(); return committed; });
  const result = runTool("log_expense", { amount: 20, description: "Private fixture expense" }, undefined, true);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await dispatched;
  setCacheOrg(change === "account_return" ? "test-org" : "other-org", change === "account_return" ? "other-user" : "test-user");
  if (change !== "workspace") setCacheOrg("test-org", "test-user");
  finish(42);
  await rejected;
  expect(write).toHaveBeenCalledOnce();
});

it("does not dispatch a new write when the task is already stopped", async () => {
  const write = vi.spyOn(fin, "createExpense");
  const controller = new AbortController();
  controller.abort();
  await expect(runTool("log_expense", { amount: 20 }, undefined, true, undefined, controller.signal))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(write).not.toHaveBeenCalled();
});

it("keeps approval valid when the active workspace identity has not changed", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([{ id: 1, number: "INV-1" }] as never);
  const status = vi.spyOn(billing, "setStatus").mockResolvedValue();
  const result = await runTool("mark_invoice_paid", { invoice_number: "INV-1" }, async () => {
    setCacheOrg("test-org", "test-user");
    return true;
  }, true);
  expect(result).toMatchObject({ ok: true });
  expect(status).toHaveBeenCalledExactlyOnceWith(1, "paid");
});

it("does not apply an invoice template after its lookup crossed workspaces", async () => {
  vi.spyOn(billing, "listDocs").mockImplementationOnce(async () => {
    setCacheOrg("other-org", "other-user");
    setCacheOrg("test-org", "test-user");
    return [{ id: 1, number: "INV-1" }] as never;
  });
  const appearance = vi.spyOn(billing, "updateAppearance").mockResolvedValue();
  await expect(runTool("set_invoice_template", { invoice_number: "INV-1", template: "minimal" }, () => true, true))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(appearance).not.toHaveBeenCalled();
});

it("reports bank balances by native currency without an invented combined total", async () => {
  vi.spyOn(settings, "settings").mockResolvedValue([
    {
      key: "bank_accounts",
      value: JSON.stringify([
        { currency: "AED", current_balance: 1000 },
        { currency: " usd ", current_balance: 100 },
        { currency: "USD", current_balance: 50 },
      ]),
    },
  ] as never);
  const result = await TOOLS.find((tool) => tool.name === "list_bank_accounts")!.run({});
  expect(result).toMatchObject({ count: 3, totals_by_currency: { AED: 1000, USD: 150 } });
  expect(result).not.toHaveProperty("total_balance");
});

it.each(["", "broken JSON", "{}", "[null]", "[[]]"])(
  "preserves an unreadable register instead of replacing it: %s",
  async (raw) => {
    vi.spyOn(settings, "settings").mockResolvedValue([
      { key: "cheque_register", value: raw },
    ] as never);
    const write = vi.spyOn(settings, "setSetting").mockResolvedValue();
    expect(
      await runTool(
        "record_cheque",
        { cheque_no: "1", type: "received", party: "Acme", amount: 100 },
        () => true
      )
    ).toMatchObject({ error: expect.stringMatching(/unreadable/) });
    expect(write).not.toHaveBeenCalled();
  }
);
