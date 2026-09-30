import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { billing, erp, hr, quotes, pos, crm, receipts, setCacheOrg, tools as settings } from "../api";
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
      {
        invoice_number: "INV-10",
        number: "INV-10",
        kind: "invoice",
        template: "minimal",
      },
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

it.each(["workspace", "cancel"] as const)("prevents multi-step record mutations after a %s change", async reason => {
  let controller = new AbortController();
  const change = () => reason === "cancel" ? controller.abort() : setCacheOrg("other-org", "other-user");
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
