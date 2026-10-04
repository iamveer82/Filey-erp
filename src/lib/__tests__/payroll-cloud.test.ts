import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
const cloud = vi.hoisted(() => ({ rpc: vi.fn(), changed: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../supabase", () => ({ isConfigured: true, supabase: null, sb: () => ({ rpc: cloud.rpc }) }));
import { hr, setCacheOrg } from "../api";
const actor = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null); setCacheOrg("workspace-a", actor);
  cloud.rpc.mockReset(); cloud.changed.mockClear();
});
afterEach(() => { setCacheOrg(null); vi.restoreAllMocks(); });

it("records cloud payroll in one atomic workspace/account-bound RPC", async () => {
  cloud.rpc.mockResolvedValue({ data: "42", error: null });
  expect(await hr.runPayroll(7, " 2026-10 ", 1000.1, 100.2, 50.3, 9)).toBe(42);
  expect(cloud.rpc).toHaveBeenCalledExactlyOnceWith("filey_run_payroll", {
    p_employee: 7, p_period: "2026-10", p_basic: 1000.1, p_allowances: 100.2,
    p_deductions: 50.3, p_account: 9, p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    p_org: "workspace-a", p_actor: actor,
  });
  expect(cloud.changed).toHaveBeenCalledOnce();
});

it("does not fall back to partial writes or report a missing/unconfirmed payroll receipt as success", async () => {
  for (const result of [{ data: null, error: { code: "PGRST202", message: "missing function" } },
    { data: null, error: null }, { data: -1, error: null }, { data: true, error: null },
    { data: null, error: { code: "23505", message: "Payroll is already recorded" } }]) {
    cloud.rpc.mockResolvedValueOnce(result);
    await expect(hr.runPayroll(7, "2026-10", 1000, 0, 0)).rejects.toThrow();
  }
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost"));
  await expect(hr.runPayroll(7, "2026-10", 1000, 0, 0)).rejects.toThrow("Response lost");
  expect(cloud.rpc).toHaveBeenCalledTimes(6);
  expect(cloud.changed).not.toHaveBeenCalled();
});

it.each([
  ["2026-00", 1, 0, 0, null], ["2026-13", 1, 0, 0, null], ["2026-10-extra", 1, 0, 0, null],
  ["2026-10", NaN, 0, 0, null], ["2026-10", 0.001, 0, 0, null], ["2026-10", 1e12, 0, 0, null],
  ["2026-10", 1, 0, 2, null], ["2026-10", 1, 0, 0, 0],
])("rejects invalid payroll before any cloud mutation (%s)", async (period, basic, allowances, deductions, account) => {
  await expect(hr.runPayroll(7, String(period), Number(basic), Number(allowances), Number(deductions), account as number | null)).rejects.toThrow("Choose an employee");
  expect(cloud.rpc).not.toHaveBeenCalled();
});

it("suppresses simultaneous clicks and rejects the old acknowledgement after a workspace change", async () => {
  let release!: (result: unknown) => void;
  cloud.rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = hr.runPayroll(7, "2026-10", 1000, 0, 0);
  const rejected = expect(pending).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.rpc).toHaveBeenCalledOnce());
  await expect(hr.runPayroll(7, "2026-10", 1000, 0, 0)).rejects.toThrow("already being recorded");
  setCacheOrg("workspace-b", actor);
  release({ data: 42, error: null });
  await rejected;
  expect(cloud.rpc).toHaveBeenCalledOnce();
  expect(cloud.changed).not.toHaveBeenCalled();
});
