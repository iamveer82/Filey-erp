import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ rpc: vi.fn(), changed: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => ({ rpc: cloud.rpc }) }));
import { fin, setCacheOrg } from "../api";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null);
  setCacheOrg("expense-receipt-org", "expense-receipt-user");
  cloud.rpc.mockReset();
  cloud.changed.mockClear();
});

afterEach(() => { setCacheOrg(null); vi.restoreAllMocks(); });

it.each([42, "42"])("returns a confirmed cloud expense record ID (%s)", async receipt => {
  cloud.rpc.mockResolvedValue({ data: receipt, error: null });
  expect(await fin.createExpense("Office", "Supplies", 10, "2026-10-04", null)).toBe(42);
  expect(cloud.rpc).toHaveBeenCalledExactlyOnceWith("filey_record_expense", { p_expense: {
    category: "Office", description: "Supplies", amount: 10, expense_date: "2026-10-04", account_id: null,
  } });
  expect(cloud.changed).toHaveBeenCalledOnce();
});

it.each([null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, [], [42], {}, "", " ", "not-an-id"].map(receipt => ({ receipt })))(
  "rejects an unconfirmed expense receipt without retrying the write ($receipt)", async ({ receipt }) => {
    cloud.rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(fin.createExpense("Office", "Supplies", 10, "2026-10-04", null)).rejects.toThrow(/could not be confirmed.*Check your expenses/i);
    expect(cloud.rpc).toHaveBeenCalledOnce();
    expect(cloud.changed).not.toHaveBeenCalled();
  },
);

it("does not retry an expense after losing its acknowledgement", async () => {
  cloud.rpc.mockRejectedValueOnce(new Error("Expense response lost"));
  await expect(fin.createExpense("Office", "Supplies", 10, "2026-10-04", null)).rejects.toThrow("Expense response lost");
  expect(cloud.rpc).toHaveBeenCalledOnce();
  expect(cloud.changed).not.toHaveBeenCalled();
});
