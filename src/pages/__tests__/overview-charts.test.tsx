import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ModernOverview from "../ModernOverview";
import { invoicePaymentsInAed, overviewDeltas, overviewTrend } from "../overviewData";
import { useDeltas, useTrend } from "../reports/useReportsData";
import { billing, crm, erp, fin, receipts, type InvoiceDocSummary, type ReceiptSummary } from "../../lib/api";
import { aed } from "../../lib/format";

const live = vi.hoisted(() => ({ reload: async () => {} }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ profile: { name: "Test" } }) }));
vi.mock("../../lib/realtime", () => ({
  useLiveSync: (reload: () => Promise<void>) => { live.reload = reload; },
  notifyDataChanged: () => {},
}));
vi.mock("../../lib/exchange-rates", async (original) => ({
  ...await original<typeof import("../../lib/exchange-rates")>(),
  getExchangeRates: vi.fn(async () => ({ AED: 1, USD: 4 })),
}));
vi.mock("../../lib/api", async (original) => {
  const api = await original<typeof import("../../lib/api")>();
  return {
    ...api,
    erp: { ...api.erp, orders: vi.fn() },
    billing: { ...api.billing, listDocs: vi.fn(), allPayments: vi.fn(), getCompany: vi.fn(async () => ({ name: "Test Co" })) },
    crm: { ...api.crm, customers: vi.fn() },
    fin: { ...api.fin, expenses: vi.fn() },
    receipts: { ...api.receipts, list: vi.fn() },
  };
});
// Inspect the exact data sent to each chart; layout/rendering stays a browser check.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  BarChart: ({ data }: { data: unknown }) => <output data-testid="sales-series">{JSON.stringify(data)}</output>,
  AreaChart: ({ data }: { data: unknown }) => <output data-testid="expense-series">{JSON.stringify(data)}</output>,
  PieChart: () => null,
  Bar: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, CartesianGrid: () => null, Pie: () => null, Cell: () => null, Legend: () => null,
}));

const invoice = (patch: Partial<InvoiceDocSummary> = {}): InvoiceDocSummary => ({
  id: 1, number: "INV-1", customer_name: "Alice", status: "sent", template: "classic",
  total: 100, paid: 25, balance: 75, currency: "USD", fx_rate: 4,
  issue_date: "2026-09-01", updated_at: "2026-09-01", ...patch,
});
const receipt = (patch: Partial<ReceiptSummary> = {}): ReceiptSummary => ({
  id: 1, number: "REC-1", customer_name: "Alice", status: "paid", template: "receipt",
  amount: 20, currency: "USD", payment_date: "2026-09-03", updated_at: "2026-09-03", ...patch,
});
const series = (chart: string) => JSON.parse(screen.getByTestId(chart).textContent || "[]") as ReturnType<typeof overviewTrend>;
const mount = () => render(<MemoryRouter><ModernOverview /></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 7, 1));
  vi.mocked(erp.orders).mockResolvedValue([]);
  vi.mocked(crm.customers).mockResolvedValue([]);
  vi.mocked(billing.allPayments).mockResolvedValue([]);
  vi.mocked(billing.listDocs).mockResolvedValue([
    invoice(),
    invoice({ id: 2, status: "overdue", total: 200, balance: 200, currency: "AED", issue_date: "2026-09-02" }),
    invoice({ id: 3, status: "cancelled", total: 9000, balance: 9000 }),
    invoice({ id: 4, status: "draft", total: 9000, balance: 9000 }),
  ]);
  vi.mocked(receipts.list).mockResolvedValue([
    receipt(), receipt({ id: 2, status: "draft", amount: 9000 }),
    receipt({ id: 3, status: "cancelled", amount: 9000 }),
  ]);
  vi.mocked(fin.expenses).mockResolvedValue([{ id: 1, category: "Travel", amount: 45, expense_date: "2026-09-04" }]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it("connects normalized invoice, receipt and expense records to both charts and the selected full period", async () => {
  mount();
  expect(screen.queryByText("Nothing to chart yet")).not.toBeInTheDocument();
  await screen.findByTestId("sales-series");
  const initial = series("sales-series");
  expect(initial).toHaveLength(7);
  expect(initial[0]).toMatchObject({ date: "2026-09-01", invoiced: 400, received: 0 });
  expect(initial[1].invoiced).toBe(200);
  expect(initial[2].received).toBe(80);
  expect(initial[3].expenses).toBe(45);
  expect(series("expense-series")).toEqual(initial);
  expect(screen.getByRole("button", { name: /Invoiced sales/ })).toHaveTextContent(aed(600).replace(/\s/g, " "));
  expect(screen.getByRole("button", { name: /Outstanding/ })).toHaveTextContent(aed(500).replace(/\s/g, " "));
  fireEvent.click(screen.getByRole("button", { name: "30d" }));
  expect(series("sales-series")).toHaveLength(30);
  expect(series("expense-series")).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "90d" }));
  expect(series("sales-series")).toHaveLength(90);
  expect(series("expense-series")).toHaveLength(90);
  expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
});

it("keeps the newer live snapshot when an older request finishes later", async () => {
  let finishOld!: (rows: InvoiceDocSummary[]) => void;
  vi.mocked(billing.listDocs).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  mount();
  await act(async () => { await live.reload(); });
  expect(series("sales-series")[0].invoiced).toBe(400);
  await act(async () => { finishOld([invoice({ total: 1 })]); });
  expect(series("sales-series")[0].invoiced).toBe(400);
  vi.mocked(receipts.list).mockResolvedValue([receipt({ amount: 30 })]);
  await act(async () => { await live.reload(); });
  expect(series("sales-series")[2].received).toBe(120);
  expect(series("expense-series")[2].received).toBe(120);
});

it("shows a retryable error instead of invented zero totals when a receipt cannot be normalized", async () => {
  vi.mocked(receipts.list).mockResolvedValue([receipt({ currency: "XXX" })]);
  mount();
  await screen.findByText(/No AED exchange rate is available/);
  expect(screen.getAllByText("Chart unavailable")).toHaveLength(3);
  expect(screen.queryByTestId("sales-series")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Invoiced sales/ })).toHaveTextContent("Data unavailable");
  vi.mocked(receipts.list).mockResolvedValue([receipt()]);
  fireEvent.click(screen.getByRole("button", { name: "Retry overview" }));
  await screen.findByTestId("sales-series");
  expect(series("sales-series")[2].received).toBe(80);
});

it("uses local calendar boundaries and omits dates outside the chosen window", () => {
  const rows = overviewTrend([
    invoice({ issue_date: "2026-08-31", total: 10 }),
    invoice({ issue_date: "2026-09-08", total: 20 }),
    invoice({ issue_date: "2026-09-07", total: 30 }),
  ], [], [], 7, new Date(2026, 8, 7, 0, 1));
  expect(rows[0].date).toBe("2026-09-01");
  expect(rows[rows.length - 1]).toMatchObject({ date: "2026-09-07", invoiced: 30 });
  expect(rows.reduce((sum, row) => sum + row.invoiced, 0)).toBe(30);
});

it("charts dated sales-invoice payments using saved FX, independently of receipt documents, and refreshes removals", async () => {
  const sales = [invoice({ issue_date: "2026-08-01", fx_rate: 3.6 })];
  const payment = { id: 8, invoice_id: 1, amount: 70, paid_at: "2026-09-05" };
  vi.mocked(billing.listDocs).mockResolvedValue(sales);
  // ID 99 is a supplier bill, absent from the sales-invoice list.
  vi.mocked(billing.allPayments).mockResolvedValue([payment, { ...payment, id: 9, invoice_id: 99, amount: 5000 }]);
  vi.mocked(receipts.list).mockResolvedValue([]);
  vi.mocked(fin.expenses).mockResolvedValue([]);
  mount();
  await screen.findByTestId("sales-series");
  const expected = series("sales-series");
  expect(expected[4]).toMatchObject({ date: "2026-09-05", invoiced: 0, received: 0, invoicePayments: 252 });
  expect(series("expense-series")).toEqual(expected);
  const normalized = invoicePaymentsInAed([payment], sales, { AED: 1, USD: 4 });
  const { result } = renderHook(() => useTrend(sales, [], normalized));
  expect(result.current).toEqual(expected);
  // A receipt may describe this same payment, but stays in its own series.
  vi.mocked(receipts.list).mockResolvedValue([receipt({ currency: "AED", amount: 252, payment_date: "2026-09-05" })]);
  await act(async () => { await live.reload(); });
  expect(series("sales-series")[4]).toMatchObject({ received: 252, invoicePayments: 252 });
  vi.mocked(billing.allPayments).mockResolvedValue([]);
  await act(async () => { await live.reload(); });
  expect(series("sales-series")[4]).toMatchObject({ received: 252, invoicePayments: 0 });
});

it("omits unposted parents and payments outside the calendar window without changing source records", () => {
  const sales = [invoice({ fx_rate: 3 }), invoice({ id: 2, status: "draft" }), invoice({ id: 3, status: "cancelled" })];
  const payments = [
    { id: 1, invoice_id: 1, amount: 10, paid_at: "2026-09-07" },
    { id: 2, invoice_id: 1, amount: 20, paid_at: "2026-09-08" },
    { id: 3, invoice_id: 1, amount: 30, paid_at: "2026-08-31" },
    { id: 4, invoice_id: 2, amount: 9000, paid_at: "2026-09-07" },
    { id: 5, invoice_id: 3, amount: 9000, paid_at: "2026-09-07" },
  ];
  const normalized = invoicePaymentsInAed(payments, sales, { AED: 1, USD: 4 });
  expect(normalized.map(row => row.id)).toEqual([1, 2, 3]);
  expect(payments[0].amount).toBe(10);
  expect(sales[0]).toMatchObject({ currency: "USD", fx_rate: 3 });
  const rows = overviewTrend([], [], [], 7, new Date(2026, 8, 7, 0, 1), normalized);
  expect(rows[6].invoicePayments).toBe(30);
  expect(rows.reduce((sum, row) => sum + row.invoicePayments, 0)).toBe(30);
});

it("does not disguise an invoice-payment read failure as zero receipts", async () => {
  vi.mocked(billing.allPayments).mockRejectedValue(new Error("Payment history unavailable"));
  mount();
  await screen.findByText("Payment history unavailable");
  expect(screen.queryByTestId("sales-series")).not.toBeInTheDocument();
  expect(screen.getAllByText("Chart unavailable")).toHaveLength(3);
});

it("keeps Overview and Reports growth identical at calendar boundaries and excludes future records", async () => {
  const rows = [
    invoice({ issue_date: "2026-08-09", total: 300, currency: "AED" }),
    invoice({ issue_date: "2026-07-10", total: 100, currency: "AED" }),
    invoice({ issue_date: "2026-08-08", total: 100, currency: "AED" }),
    invoice({ issue_date: "2026-07-09", total: 9000, currency: "AED" }),
    invoice({ issue_date: "2026-09-08", total: 9000, currency: "AED" }),
  ];
  const payments = rows.map(row => receipt({ payment_date: row.issue_date || "", amount: row.total }));
  const expected = overviewDeltas(rows, payments, [], []);
  expect(expected).toEqual({ revenue: 50, cash: 50, customers: null, orders: null });
  const { result } = renderHook(() => useDeltas(rows, payments, [], []));
  expect(result.current).toEqual(expected);
  vi.mocked(billing.listDocs).mockResolvedValue(rows);
  mount();
  await screen.findByRole("button", { name: /Invoiced sales.*\+50.0%/ });
});
