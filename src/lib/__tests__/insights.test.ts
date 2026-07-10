import { describe, it, expect } from "vitest";
import {
  cashflowForecast,
  overdueCustomers,
  expenseAnomalies,
  stockoutEtas,
  buildInsights,
} from "../insights";

const TODAY = "2026-07-11";

describe("cashflowForecast", () => {
  it("buckets unpaid balances by due window and adds expense run-rate", () => {
    const sales = [
      { customer_name: "A", status: "sent", total: 1000, paid: 0, due_date: "2026-07-20" },
      { customer_name: "B", status: "sent", total: 500, paid: 0, due_date: "2026-06-30" }, // overdue → first bucket
      { customer_name: "C", status: "sent", total: 800, paid: 0, due_date: "2026-08-25" }, // 31–60
      { customer_name: "D", status: "paid", total: 900, paid: 900, due_date: "2026-07-15" }, // settled — ignored
      { customer_name: "E", status: "draft", total: 700, paid: 0, due_date: "2026-07-15" }, // draft — ignored
    ];
    const purchases = [
      { customer_name: "Sup", status: "sent", total: 300, paid: 0, due_date: "2026-07-25" },
    ];
    // 3 months of 300 = run-rate 100/bucket… (900 total / 3)
    const expenses = [
      { category: "Rent", amount: 300, expense_date: "2026-05-05" },
      { category: "Rent", amount: 300, expense_date: "2026-06-05" },
      { category: "Rent", amount: 300, expense_date: "2026-07-05" },
    ];
    const [b30, b60] = cashflowForecast(sales, purchases, expenses, TODAY);
    expect(b30.incoming).toBe(1500); // A + overdue B
    expect(b30.outgoing).toBe(300 + 300); // supplier bill + run-rate 300
    expect(b30.net).toBe(900);
    expect(b60.incoming).toBe(800); // C
  });
});

describe("overdueCustomers", () => {
  it("aggregates overdue balances per customer with oldest days", () => {
    const sales = [
      { customer_name: "Acme", status: "sent", total: 100, paid: 0, due_date: "2026-07-01" },
      { customer_name: "Acme", status: "sent", total: 200, paid: 50, due_date: "2026-06-01" },
      { customer_name: "Zed", status: "sent", total: 999, paid: 999, due_date: "2026-06-01" }, // paid
      { customer_name: "New", status: "sent", total: 50, paid: 0, due_date: "2026-08-01" }, // not due yet
    ];
    const out = overdueCustomers(sales, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Acme");
    expect(out[0].amount).toBe(250);
    expect(out[0].oldestDays).toBe(40);
    expect(out[0].invoices).toBe(2);
  });
});

describe("expenseAnomalies", () => {
  it("flags categories at 2x+ their prior 3-month average", () => {
    const expenses = [
      { category: "Software", amount: 100, expense_date: "2026-04-15" },
      { category: "Software", amount: 100, expense_date: "2026-05-15" },
      { category: "Software", amount: 100, expense_date: "2026-06-15" },
      { category: "Software", amount: 400, expense_date: "2026-07-05" }, // 4× the 100 avg
      { category: "Meals", amount: 90, expense_date: "2026-06-20" },
      { category: "Meals", amount: 95, expense_date: "2026-07-02" }, // ~3× of 30 avg but < 100 floor
    ];
    const out = expenseAnomalies(expenses, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Software");
    expect(out[0].ratio).toBeCloseTo(4, 5);
  });

  it("needs history — brand-new categories are not spikes", () => {
    const out = expenseAnomalies(
      [{ category: "Legal", amount: 5000, expense_date: "2026-07-03" }],
      TODAY
    );
    expect(out).toHaveLength(0);
  });
});

describe("stockoutEtas", () => {
  it("projects days-to-stockout from 30-day outflow velocity", () => {
    const products = [
      { id: 1, name: "Widget", quantity: 10, reorder_level: 15 },
      { id: 2, name: "Slow", quantity: 100, reorder_level: 5 },
      { id: 3, name: "Dormant", quantity: 2, reorder_level: 5 }, // no movement → skipped
    ];
    const movements = {
      "1": [
        { qty: -30, moved_at: "2026-07-01T00:00:00Z" }, // 1/day
        { qty: 20, moved_at: "2026-07-02T00:00:00Z" }, // inbound — ignored
      ],
      "2": [{ qty: -3, moved_at: "2026-07-05T00:00:00Z" }], // 0.1/day → ~1000 days
    };
    const out = stockoutEtas(products, movements, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Widget");
    expect(out[0].daysLeft).toBe(10);
    expect(out[0].belowReorder).toBe(true);
  });
});

describe("buildInsights", () => {
  it("orders by severity and links each insight", () => {
    const list = buildInsights({
      sales: [
        { customer_name: "Late Co", status: "sent", total: 9000, paid: 0, due_date: "2026-05-01" },
      ],
      purchases: [
        { customer_name: "Sup", status: "sent", total: 20000, paid: 0, due_date: "2026-07-20" },
      ],
      expenses: [],
      products: [],
      movements: {},
      today: TODAY,
    });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].severity).toBe("critical"); // cash gap (20k out vs 9k in)
    expect(list.every((i) => i.title && i.detail)).toBe(true);
  });
});
