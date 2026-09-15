import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePayablesAging, paidByPo } from "./useReportsData";

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

describe("paidByPo", () => {
  it("sums multiple payments per PO", () => {
    const m = paidByPo([
      { po_id: 1, amount: 100 },
      { po_id: 1, amount: 50 },
      { po_id: 2, amount: 25 },
    ]);
    expect(m.get(1)).toBe(150);
    expect(m.get(2)).toBe(25);
  });
});

describe("usePayablesAging", () => {
  const bill = (over: Partial<any> = {}) => ({
    id: 1,
    number: "BILL-1",
    customer_name: "Acme",
    status: "sent",
    total: 1000,
    balance: 1000,
    paid: 0,
    items_count: 1,
    order_date: daysAgo(60),
    updated_at: daysAgo(60),
    ...over,
  });

  it("counts only the unpaid remainder", () => {
    const { result } = renderHook(() =>
      usePayablesAging([bill({ due_date: daysAgo(10), balance:600, paid:400 })] as any)
    );
    expect(result.current.d30).toBe(600);
  });

  it("drops a bill that is fully paid but not yet marked paid", () => {
    const { result } = renderHook(() =>
      usePayablesAging([bill({ due_date: daysAgo(10), balance:0, paid:1000 })] as any)
    );
    const total =
      result.current.current +
      result.current.d30 +
      result.current.d60 +
      result.current.d90 +
      result.current.d90p;
    expect(total).toBe(0);
  });

  it("buckets by how far past the due date it is", () => {
    const { result } = renderHook(() =>
      usePayablesAging(
        [
          bill({ id: 1, due_date: daysAgo(-5) }), // not due yet
          bill({ id: 2, due_date: daysAgo(15) }),
          bill({ id: 3, due_date: daysAgo(45) }),
          bill({ id: 4, due_date: daysAgo(75) }),
          bill({ id: 5, due_date: daysAgo(200) }),
        ] as any
      )
    );
    expect(result.current).toEqual({
      current: 1000,
      d30: 1000,
      d60: 1000,
      d90: 1000,
      d90p: 1000,
    });
  });

  it("still ignores draft, cancelled and paid bills", () => {
    const { result } = renderHook(() =>
      usePayablesAging(
        [
          bill({ id: 1, status: "draft" }),
          bill({ id: 2, status: "cancelled" }),
          bill({ id: 3, status: "paid" }),
        ] as any
      )
    );
    expect(result.current.current).toBe(0);
  });
});
