// Business insights, computed locally from the books — no AI key, no network.
// Pure functions over plain rows so they run identically in local and cloud
// mode and are trivially testable. The dashboard card feeds them straight
// from the list APIs.

export type InsightSeverity = "info" | "warn" | "critical";

export interface Insight {
  kind: "cashflow" | "overdue" | "expense" | "stock";
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** In-app route the insight links to. */
  to?: string;
}

/* ── shared row shapes (subsets of the api.ts types) ─────────────────────── */

export interface DocRow {
  customer_name: string;
  status: string;
  total: number;
  paid?: number;
  due_date?: string;
  issue_date?: string;
}

export interface ExpenseRow {
  category: string;
  amount: number;
  expense_date: string;
}

export interface ProductRow {
  id: number;
  name: string;
  quantity: number;
  reorder_level: number;
}

export interface MovementRow {
  qty: number; // signed: negative = out
  moved_at: string;
}

const DAY = 86400000;
const money = (n: number) => Math.round(n).toLocaleString("en-AE");

const daysBetween = (a: string, b: string): number => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return 0;
  return Math.floor((tb - ta) / DAY);
};

/** Outstanding balance of an issued, unpaid document. */
const balance = (d: DocRow): number =>
  Math.max(0, Number(d.total) - Number(d.paid ?? 0));

const isOpen = (d: DocRow): boolean =>
  d.status !== "draft" && d.status !== "void" && balance(d) > 0.005;

/* ── cashflow forecast: expected in/out over 30/60/90 days ───────────────── */

export interface CashflowBucket {
  label: string; // "Next 30 days" …
  incoming: number; // unpaid sales balances due in the window (overdue → first)
  outgoing: number; // unpaid supplier bills due + expense run-rate
  net: number;
}

export function cashflowForecast(
  sales: DocRow[],
  purchases: DocRow[],
  expenses: ExpenseRow[],
  today: string
): CashflowBucket[] {
  // Average monthly spend over the last 3 full months = the run-rate part of
  // each bucket's outgoing.
  const threeMonthsAgo = new Date(Date.parse(today) - 92 * DAY)
    .toISOString()
    .slice(0, 10);
  const recentSpend = expenses
    .filter((e) => e.expense_date >= threeMonthsAgo && e.expense_date <= today)
    .reduce((s, e) => s + Number(e.amount), 0);
  const runRate = recentSpend / 3;

  const buckets = [
    { label: "Next 30 days", from: 0, to: 30 },
    { label: "31–60 days", from: 31, to: 60 },
    { label: "61–90 days", from: 61, to: 90 },
  ];
  return buckets.map((b) => {
    const inWindow = (d: DocRow) => {
      // No due date → treat as due now (first bucket). Overdue → first bucket.
      const due = d.due_date || today;
      const dd = Math.max(0, daysBetween(today, due));
      return dd >= b.from && dd <= b.to;
    };
    const incoming = sales.filter(isOpen).filter(inWindow).reduce((s, d) => s + balance(d), 0);
    const bills = purchases.filter(isOpen).filter(inWindow).reduce((s, d) => s + balance(d), 0);
    const outgoing = bills + runRate;
    return { label: b.label, incoming, outgoing, net: incoming - outgoing };
  });
}

/* ── overdue risk: who owes, how much, how late ──────────────────────────── */

export interface OverdueCustomer {
  name: string;
  amount: number;
  oldestDays: number;
  invoices: number;
}

export function overdueCustomers(sales: DocRow[], today: string): OverdueCustomer[] {
  const map = new Map<string, OverdueCustomer>();
  for (const d of sales) {
    if (!isOpen(d) || !d.due_date || d.due_date >= today) continue;
    const late = daysBetween(d.due_date, today);
    const key = d.customer_name || "(no name)";
    const cur = map.get(key) ?? { name: key, amount: 0, oldestDays: 0, invoices: 0 };
    cur.amount += balance(d);
    cur.oldestDays = Math.max(cur.oldestDays, late);
    cur.invoices++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/* ── expense anomalies: this month vs the prior 3-month average ──────────── */

export interface ExpenseSpike {
  category: string;
  thisMonth: number;
  monthlyAvg: number;
  ratio: number;
}

export function expenseAnomalies(expenses: ExpenseRow[], today: string): ExpenseSpike[] {
  const month = today.slice(0, 7);
  const start = new Date(Date.parse(month + "-01") - 92 * DAY).toISOString().slice(0, 10);
  const current = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const e of expenses) {
    const cat = e.category || "Other";
    if (e.expense_date.slice(0, 7) === month)
      current.set(cat, (current.get(cat) ?? 0) + Number(e.amount));
    else if (e.expense_date >= start && e.expense_date < month + "-01")
      prior.set(cat, (prior.get(cat) ?? 0) + Number(e.amount));
  }
  const out: ExpenseSpike[] = [];
  for (const [cat, now] of current) {
    const avg = (prior.get(cat) ?? 0) / 3;
    // A spike needs history to compare against and enough money to matter.
    if (avg > 0 && now >= 100 && now >= avg * 2)
      out.push({ category: cat, thisMonth: now, monthlyAvg: avg, ratio: now / avg });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/* ── stockout ETA: consumption velocity vs current quantity ──────────────── */

export interface StockoutEta {
  productId: number;
  name: string;
  quantity: number;
  daysLeft: number;
  belowReorder: boolean;
}

export function stockoutEtas(
  products: ProductRow[],
  movementsByProduct: Record<string, MovementRow[]>,
  today: string,
  horizonDays = 14
): StockoutEta[] {
  const cutoff = new Date(Date.parse(today) - 30 * DAY).toISOString();
  const out: StockoutEta[] = [];
  for (const p of products) {
    const moves = movementsByProduct[String(p.id)] ?? [];
    const consumed = moves
      .filter((m) => m.qty < 0 && m.moved_at >= cutoff)
      .reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
    if (consumed <= 0) continue; // no recent outflow → no velocity to project
    const perDay = consumed / 30;
    const daysLeft = Math.floor(Math.max(0, Number(p.quantity)) / perDay);
    if (daysLeft <= horizonDays)
      out.push({
        productId: p.id,
        name: p.name,
        quantity: Number(p.quantity),
        daysLeft,
        belowReorder: Number(p.quantity) <= Number(p.reorder_level),
      });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ── roll-up for the dashboard card ──────────────────────────────────────── */

export function buildInsights(input: {
  sales: DocRow[];
  purchases: DocRow[];
  expenses: ExpenseRow[];
  products: ProductRow[];
  movements: Record<string, MovementRow[]>;
  today: string;
  currency?: string;
}): Insight[] {
  const cur = input.currency || "AED";
  const list: Insight[] = [];

  const flow = cashflowForecast(input.sales, input.purchases, input.expenses, input.today);
  const next30 = flow[0];
  if (next30.net < 0)
    list.push({
      kind: "cashflow",
      severity: "critical",
      title: `Cash gap of ${cur} ${money(-next30.net)} in the next 30 days`,
      detail: `Expected in ${cur} ${money(next30.incoming)} vs out ${cur} ${money(next30.outgoing)} (bills + spend run-rate). Chase receivables or delay spend.`,
      to: "/accounting",
    });
  else if (next30.incoming > 0 || next30.outgoing > 0)
    list.push({
      kind: "cashflow",
      severity: "info",
      title: `${cur} ${money(next30.net)} expected net cash over 30 days`,
      detail: `In ${cur} ${money(next30.incoming)}, out ${cur} ${money(next30.outgoing)}.`,
      to: "/accounting",
    });

  const late = overdueCustomers(input.sales, input.today);
  const lateTotal = late.reduce((s, c) => s + c.amount, 0);
  if (late.length) {
    const worst = late[0];
    list.push({
      kind: "overdue",
      severity: worst.oldestDays > 30 ? "critical" : "warn",
      title: `${cur} ${money(lateTotal)} overdue from ${late.length} customer${late.length > 1 ? "s" : ""}`,
      detail: `Largest: ${worst.name} — ${cur} ${money(worst.amount)}, oldest ${worst.oldestDays} days late. Send reminders from Invoicing.`,
      to: "/invoicing",
    });
  }

  for (const s of expenseAnomalies(input.expenses, input.today).slice(0, 2))
    list.push({
      kind: "expense",
      severity: "warn",
      title: `${s.category} spend is ${s.ratio.toFixed(1)}× the usual`,
      detail: `${cur} ${money(s.thisMonth)} this month vs ${cur} ${money(s.monthlyAvg)}/month average. Worth a look.`,
      to: "/accounting",
    });

  const stock = stockoutEtas(input.products, input.movements, input.today);
  for (const s of stock.slice(0, 2))
    list.push({
      kind: "stock",
      severity: s.daysLeft <= 5 ? "critical" : "warn",
      title: `${s.name} runs out in ~${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`,
      detail: `${s.quantity} left at the current sales pace${s.belowReorder ? " — already below its reorder level" : ""}. Raise a purchase order.`,
      to: "/inventory",
    });

  const rank = { critical: 0, warn: 1, info: 2 };
  return list.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
