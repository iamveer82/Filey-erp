import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, erp, hr, quotes, pos, crm, suppliers, receipts, setCacheOrg, tools as settings } from "../api";
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
afterEach(() => vi.restoreAllMocks());

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
  expect(invoices).toHaveBeenCalled();
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
