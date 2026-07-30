// Payables must be net of what has already been paid. A PO keeps its full
// total and a non-paid status until it is settled, so reading p.total straight
// off the list bills the whole order as still owed.
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
  const po = (over: Partial<any> = {}) => ({
    id: 1,
    po_number: "PO-1",
    supplier_name: "Acme",
    status: "sent",
    total: 1000,
    items_count: 1,
    order_date: daysAgo(60),
    updated_at: daysAgo(60),
    ...over,
  });

  it("counts only the unpaid remainder", () => {
    const { result } = renderHook(() =>
      usePayablesAging([po({ expected_date: daysAgo(10) })] as any, [
        { po_id: 1, amount: 400 },
      ])
    );
    expect(result.current.d30).toBe(600);
  });

  it("drops a PO that is fully paid but not yet marked paid", () => {
    const { result } = renderHook(() =>
      usePayablesAging([po({ expected_date: daysAgo(10) })] as any, [
        { po_id: 1, amount: 1000 },
      ])
    );
    const total =
      result.current.current +
      result.current.d30 +
      result.current.d60 +
      result.current.d90 +
      result.current.d90p;
    expect(total).toBe(0);
  });

  it("buckets by how far past the expected date it is", () => {
    const { result } = renderHook(() =>
      usePayablesAging(
        [
          po({ id: 1, expected_date: daysAgo(-5) }), // not due yet
          po({ id: 2, expected_date: daysAgo(15) }),
          po({ id: 3, expected_date: daysAgo(45) }),
          po({ id: 4, expected_date: daysAgo(75) }),
          po({ id: 5, expected_date: daysAgo(200) }),
        ] as any,
        []
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

  it("still ignores draft, cancelled and paid orders", () => {
    const { result } = renderHook(() =>
      usePayablesAging(
        [
          po({ id: 1, status: "draft" }),
          po({ id: 2, status: "cancelled" }),
          po({ id: 3, status: "paid" }),
        ] as any,
        []
      )
    );
    expect(result.current.current).toBe(0);
  });
});
