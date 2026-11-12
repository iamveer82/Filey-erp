import { expect, it } from "vitest";
import type { InvoiceDocSummary, InvoicePayment } from "../../lib/api";
import { paymentSpeed } from "./useReportsData";

const inv = (id: number, customer: string, issue: string, due: string, total = 100, status = "paid") =>
  ({ id, number: `INV-${id}`, customer_name: customer, issue_date: issue, due_date: due, total, status }) as InvoiceDocSummary;
const pay = (invoice_id: number, paid_at: string, amount: number) => ({ id: invoice_id * 10, invoice_id, paid_at, amount }) as InvoicePayment;

it("ranks customers by average days to full payment and days past due", () => {
  const rows = paymentSpeed(
    [inv(1, "Quick Co", "2026-09-01", "2026-09-30"), inv(2, "Slow Co", "2026-09-01", "2026-09-15"), inv(3, "Slow Co", "2026-09-10", "2026-09-20"),
      inv(4, "Unknown Co", "2026-09-01", "2026-09-30"), inv(5, "Draft Co", "2026-09-01", "2026-09-30", 100, "draft")],
    [pay(1, "2026-09-05", 100), pay(2, "2026-09-20", 40), pay(2, "2026-10-01", 60), pay(3, "2026-10-10", 100), pay(5, "2026-09-02", 100)],
  );
  expect(rows).toEqual([
    { name: "Slow Co", paidInvoices: 2, avgDays: 30, avgDaysLate: 18 }, // 30 and 30 days; 16 and 20 days late
    { name: "Quick Co", paidInvoices: 1, avgDays: 4, avgDaysLate: 0 },
  ]);
});
