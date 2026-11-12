import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { billing, hr, tools, type CompanyProfile, type Employee, type Payroll } from "../../lib/api";
import { UIProvider } from "../../lib/ui";
import RunPayrollModal from "../RunPayrollModal";
import { leaveDeduction } from "../../lib/payroll";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const employees = [
  { id: 1, name: "Asha", salary: 30000, status: "active" },
  { id: 2, name: "Ravi", salary: 20000, status: "active" },
  { id: 3, name: "Left Co", salary: 9000, status: "inactive" },
] as Employee[];

it("takes unpaid leave off pro rata", () => {
  expect(leaveDeduction(30000, 3, "2026-09")).toBe(3000); // 30 days in September
  expect(leaveDeduction(31000, 1, "2026-10")).toBe(1000);
  expect(leaveDeduction(30000, 99, "2026-09")).toBe(30000);
});

it("runs the month for every active employee not already paid, with this month's changes", async () => {
  vi.spyOn(hr, "payroll").mockResolvedValue([{ id: 9, employee_id: 2, period: "2026-09", basic: 20000, allowances: 0, deductions: 0, net_pay: 20000, status: "paid" } as Payroll]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ country_code: "AE", currency: "AED" } as CompanyProfile);
  vi.spyOn(tools, "settings").mockResolvedValue([]);
  const post = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  const onDone = vi.fn();
  render(<UIProvider><RunPayrollModal open employees={employees} onClose={() => {}} onDone={onDone} /></UIProvider>);
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-09" } });
  expect(await screen.findByText("Already recorded")).toBeInTheDocument();
  expect(screen.queryByText("Left Co")).toBeNull();
  fireEvent.change(screen.getByLabelText("Allowances for Asha"), { target: { value: "2000" } });
  fireEvent.change(screen.getByLabelText("Unpaid days for Asha"), { target: { value: "3" } });
  expect(screen.getByText(/1 to pay/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run payroll" }));
  // The confirm dialog has its own "Run payroll" button, the only one reachable while it is open.
  expect(await screen.findByText("Run payroll for 2026-09?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run payroll" }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(1, "2026-09", 30000, 2000, 3000));
  expect(post).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalled();
});

it("adds EPF and professional tax for an Indian business and keeps the split for the payslip", async () => {
  vi.spyOn(hr, "payroll").mockResolvedValue([]);
  vi.spyOn(billing, "getCompany").mockResolvedValue({ country_code: "IN", currency: "INR" } as CompanyProfile);
  vi.spyOn(tools, "settings").mockResolvedValue([{ key: "india_payroll", value: JSON.stringify({ pf: true, ptState: "Maharashtra" }) }] as never);
  const saved = vi.spyOn(tools, "setSetting").mockResolvedValue(undefined);
  const post = vi.spyOn(hr, "runPayroll").mockResolvedValue(1);
  render(<UIProvider><RunPayrollModal open employees={employees.slice(0, 1)} onClose={() => {}} onDone={() => {}} /></UIProvider>);
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-09" } });
  expect(await screen.findByLabelText("PF for Asha")).toHaveValue(1800);
  expect(screen.getByLabelText("PT for Asha")).toHaveValue(200);
  fireEvent.click(screen.getByRole("button", { name: "Run payroll" }));
  expect(await screen.findByText("Run payroll for 2026-09?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run payroll" }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(1, "2026-09", 30000, 0, 2000));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("payroll_breakdown", expect.stringContaining('"1:2026-09":{"pf":1800,"esi":0,"pt":200')));
});
