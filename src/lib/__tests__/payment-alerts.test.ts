import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bankEmail, bankSms, bankSmsIn, matchAlerts, parseAlert, parseAlertState, queueAlerts, settleAlert } from "../paymentAlerts";
import { alertsFromGmail, checkPayments, confirmMatch } from "../paymentWatch";
import { billing, tools, type InvoiceDocSummary } from "../api";

let settings: { key: string; value: string }[] = [];
beforeEach(() => {
  settings = [];
  vi.spyOn(tools, "settings").mockImplementation(async () => settings as never);
  vi.spyOn(tools, "setSetting").mockImplementation(async (key, value) => { settings = [...settings.filter((s) => s.key !== key), { key, value }]; });
});
afterEach(() => vi.restoreAllMocks());

const SMS = {
  hdfc: "Rs.1180.00 credited to HDFC Bank A/c XX4321 on 01-11-26 from VPA ravi.traders@okaxis (UPI 430512345678)",
  sbi: "Dear UPI user A/C X7788 credited by Rs 2,360.00 on 01Nov26 trf from ANITA SHARMA Refno 430598765432. If not you, call 1800111109 -SBI",
  icici: "ICICI Bank Acct XX901 credited with INR 590.00 on 31-Oct-26 by UPI/CR/430511112222/Mohan Lal. Avl Bal INR 45,210.55",
  debit: "Rs.500.00 debited from A/c XX4321 on 01-11-26 to VPA shop@ybl (UPI 430599990000). Not you? Call 18002586161",
  otp: "123456 is your OTP for UPI. Do not share. Rs 100 credited offers inside",
};

it("reads the amount, UPI reference, payer and date from bank credit alerts", () => {
  expect(parseAlert(SMS.hdfc, "sms")).toMatchObject({ amount: 1180, utr: "430512345678", vpa: "ravi.traders@okaxis", date: "2026-11-01", key: "utr:430512345678" });
  expect(parseAlert(SMS.sbi, "sms")).toMatchObject({ amount: 2360, utr: "430598765432", payer: "ANITA SHARMA", date: "2026-11-01" });
  // The balance after the credit is not the payment.
  expect(parseAlert(SMS.icici, "sms")).toMatchObject({ amount: 590, utr: "430511112222", date: "2026-10-31" });
});

it("ignores debits, OTPs and text that is not an alert", () => {
  expect(parseAlert(SMS.debit, "sms")).toBeNull();
  expect(parseAlert(SMS.otp, "sms")).toBeNull();
  expect(parseAlert("Hello, please send the invoice", "pasted")).toBeNull();
});

it("only trusts known bank senders", () => {
  expect(bankEmail("HDFC Bank InstaAlerts <alerts@hdfcbank.net>")).toBe(true);
  expect(bankEmail("SBI <donotreply.sbiatm@alerts.sbi.bank.in>")).toBe(true);
  expect(bankEmail("Prize team <alerts@hdfcbank.net.example.com>")).toBe(false);
  expect(bankEmail("someone@gmail.com")).toBe(false);
  expect(bankSms("VM-HDFCBK")).toBe(true);
  expect(bankSms("AD-SBIUPI-S")).toBe(true);
  expect(bankSms("VK-OFFERS")).toBe(false);
  expect(bankSmsIn("SMS from JD-ICICIT: ICICI Bank Acct credited")).toBe(true);
});

const inv = (id: number, number: string, balance: number, extra: Partial<InvoiceDocSummary> = {}) =>
  ({ id, number, customer_name: `Customer ${id}`, status: "sent", currency: "INR", total: balance, balance, issue_date: "2026-10-20", ...extra }) as InvoiceDocSummary;

it("matches each payment to unpaid rupee invoices with exactly that balance", () => {
  const alert = parseAlert(SMS.hdfc, "sms")!;
  const [m] = matchAlerts([alert], [inv(1, "INV-1", 1180), inv(2, "INV-2", 1180, { status: "paid", balance: 0 }), inv(3, "INV-3", 1180, { currency: "USD" }),
    inv(4, "INV-4", 1180, { issue_date: "2026-11-05" }), inv(5, "INV-5", 999)]);
  expect(m.candidates.map((c) => c.number)).toEqual(["INV-1"]);
  const [two] = matchAlerts([alert], [inv(1, "INV-1", 1180), inv(6, "INV-6", 1180, { status: "overdue" })]);
  expect(two.candidates).toHaveLength(2);
});

it("counts each reference once", () => {
  const a = parseAlert(SMS.hdfc, "sms")!;
  const queued = queueAlerts(parseAlertState(null), [a, a]);
  expect(queued.added).toHaveLength(1);
  const state = settleAlert(queued.state, a.key);
  expect(state.pending).toEqual([]);
  expect(queueAlerts(state, [a]).added).toEqual([]);
  expect(parseAlertState("broken").auto).toBe(true);
});

it("reads bank emails and forwarded bank SMS from Gmail, and nothing else", () => {
  const alerts = alertsFromGmail({ messages: [
    { sender: "HDFC Bank <alerts@hdfcbank.net>", subject: "You have received a UPI payment", messageText: SMS.hdfc, messageTimestamp: "1793500000" },
    { sender: "me@gmail.com", subject: "SMS from AD-SBIUPI", messageText: SMS.sbi },
    { sender: "lottery@win.example", subject: "Rs 50,000 credited!", messageText: "Rs 50,000 credited to you, Ref 999999999999" },
  ] });
  expect(alerts.map((a) => [a.source, a.utr])).toEqual([["email", "430512345678"], ["sms", "430598765432"]]);
});

it("queues a pasted alert and records the payment only when confirmed", async () => {
  vi.spyOn(billing, "listDocs").mockResolvedValue([inv(1, "INV-1", 1180)]);
  const pay = vi.spyOn(billing, "addPayment").mockResolvedValue(77);
  const result = await checkPayments([parseAlert(SMS.hdfc, "pasted")!], false);
  expect(result.matches[0].candidates[0].number).toBe("INV-1");
  expect(pay).not.toHaveBeenCalled();
  await confirmMatch(result.matches[0].alert, 1);
  expect(pay).toHaveBeenCalledWith(1, 1180, "UPI 430512345678", "2026-11-01");
  const again = await checkPayments([parseAlert(SMS.hdfc, "pasted")!], false);
  expect(again.added).toEqual([]);
  expect(again.matches).toEqual([]);
});
