import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import AdvanceCard, { CustomerAdvancesPanel } from "../AdvanceCard";
import { advances, crm, type Advance } from "../../lib/api";

const ui = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, confirm: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ui }));
vi.mock("../../lib/api", () => ({
  advances: { forParty: vi.fn(), list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() },
  crm: { customers: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (id: number, amount: number): Advance => ({ id, amount, party_type: "customer", party_id: id,
  party_name: `Customer ${id}`, paid_at: "2026-09-01", created_at: "2026-09-01" });
beforeEach(() => {
  vi.mocked(advances.forParty).mockReset().mockResolvedValue([]);
  vi.mocked(advances.list).mockReset().mockResolvedValue([]);
  vi.mocked(advances.add).mockReset().mockResolvedValue(10);
  vi.mocked(advances.update).mockReset().mockResolvedValue(undefined);
  vi.mocked(advances.remove).mockReset().mockResolvedValue(undefined);
  vi.mocked(crm.customers).mockReset().mockResolvedValue([{ id: 1, name: "Customer 1", created_at: "2026-09-01" }]);
  ui.confirm.mockReset().mockResolvedValue(true);
  ui.toast.success.mockClear(); ui.toast.error.mockClear();
});
afterEach(cleanup);

it("never shows guessed credit, ignores an older party read and retries a failed current read", async () => {
  const first = deferred<Advance[]>(), failed = deferred<Advance[]>();
  vi.mocked(advances.forParty).mockImplementation((_kind, id) => id === 1 ? first.promise : id === 3 ? failed.promise : Promise.resolve([row(id, 40)]));
  const view = render(<AdvanceCard partyType="customer" partyId={1} partyName="Customer 1" />);
  expect(view.getByRole("status")).toHaveTextContent("Loading advances");
  expect(view.queryByText("credit balance")).not.toBeInTheDocument();
  expect(view.queryByText("No advances recorded yet.")).not.toBeInTheDocument();
  view.rerender(<AdvanceCard partyType="customer" partyId={2} partyName="Customer 2" />);
  await view.findByText(/credit balance/);
  expect(view.getByText(/credit balance/).parentElement).toHaveTextContent("40.00");
  await act(async () => first.resolve([row(1, 80)]));
  expect(view.getByText(/credit balance/).parentElement).toHaveTextContent("40.00");
  expect(view.queryByText(/80.00/)).not.toBeInTheDocument();
  view.rerender(<AdvanceCard partyType="customer" partyId={3} partyName="Customer 3" />);
  expect(view.queryByText(/credit balance/)).not.toBeInTheDocument();
  await act(async () => failed.reject(new Error("Credit read failed")));
  expect(view.getByRole("alert")).toHaveTextContent("Credit read failed");
  expect(view.queryByText("No advances recorded yet.")).not.toBeInTheDocument();
  vi.mocked(advances.forParty).mockResolvedValue([row(3, 20)]);
  fireEvent.click(view.getByRole("button", { name: "Retry advances" }));
  await view.findByText(/credit balance/);
  expect(view.getByText(/credit balance/).parentElement).toHaveTextContent("20.00");
});

it("fences mutation refreshes and stale mutation completions when navigating to another party", async () => {
  const refresh = deferred<Advance[]>(), saved = deferred<void>();
  vi.mocked(advances.forParty).mockResolvedValueOnce([row(1, 10)]).mockImplementation((_kind, id) => id === 1 ? refresh.promise : Promise.resolve([row(id, 30)]));
  const view = render(<AdvanceCard partyType="customer" partyId={1} partyName="Customer 1" />);
  await view.findByText(/credit balance/);
  fireEvent.click(view.getByRole("button", { name: "Add" }));
  fireEvent.change(view.getByRole("spinbutton"), { target: { value: "20" } });
  fireEvent.click(view.getByRole("button", { name: "Save advance" }));
  await view.findByRole("status");
  expect(view.queryByText(/credit balance/)).not.toBeInTheDocument();
  expect(view.queryByRole("button", { name: "Edit advance" })).not.toBeInTheDocument();
  view.rerender(<AdvanceCard partyType="customer" partyId={2} partyName="Customer 2" />);
  await view.findByText(/credit balance/);
  await act(async () => refresh.resolve([row(1, 90)]));
  expect(view.getByText(/credit balance/).parentElement).toHaveTextContent("30.00");
  vi.mocked(advances.update).mockReturnValueOnce(saved.promise);
  fireEvent.click(view.getByRole("button", { name: "Edit advance" }));
  fireEvent.change(view.getByRole("spinbutton"), { target: { value: "45" } });
  fireEvent.click(view.getByRole("button", { name: "Update advance" }));
  await waitFor(() => expect(advances.update).toHaveBeenCalledTimes(1));
  view.rerender(<AdvanceCard partyType="supplier" partyId={3} partyName="Supplier 3" />);
  await view.findByText(/credit balance/);
  view.rerender(<AdvanceCard partyType="customer" partyId={2} partyName="Customer 2" />);
  await view.findByText(/credit balance/);
  fireEvent.click(view.getByRole("button", { name: "Edit advance" }));
  const calls = vi.mocked(advances.forParty).mock.calls.length;
  await act(async () => saved.resolve());
  expect(advances.forParty).toHaveBeenCalledTimes(calls);
  expect(view.getByRole("dialog")).toBeInTheDocument();
  expect(view.getByText(/credit balance/).parentElement).toHaveTextContent("30.00");
});

it.each(["advances", "customers"] as const)("customer dashboard reports a failed %s source and retries without a false empty balance", async source => {
  if (source === "advances") vi.mocked(advances.list).mockRejectedValueOnce(new Error("Read denied"));
  else vi.mocked(crm.customers).mockRejectedValueOnce(new Error("Read denied"));
  const view = render(<CustomerAdvancesPanel />);
  expect(view.getByRole("status")).toHaveTextContent("Loading advances");
  await view.findByRole("alert");
  expect(view.queryByText(/No advances on file/)).not.toBeInTheDocument();
  expect(view.getByRole("button", { name: "Add advance" })).toBeDisabled();
  vi.mocked(advances.list).mockResolvedValue([row(1, 25)]);
  fireEvent.click(view.getByRole("button", { name: "Retry advances" }));
  await view.findByRole("button", { name: /Customer 1/ });
  expect(view.getByRole("button", { name: "Add advance" })).toBeEnabled();
  expect(view.queryByRole("alert")).not.toBeInTheDocument();
});

it("hides dashboard rows during a mutation refresh and exposes retry instead of false emptiness if that refresh fails", async () => {
  const refresh = deferred<Advance[]>();
  vi.mocked(advances.list).mockResolvedValueOnce([row(1, 25)]).mockReturnValueOnce(refresh.promise);
  const view = render(<CustomerAdvancesPanel />);
  fireEvent.click(await view.findByRole("button", { name: /Customer 1/ }));
  fireEvent.click(view.getByRole("button", { name: "Edit advance" }));
  fireEvent.change(view.getByRole("spinbutton"), { target: { value: "30" } });
  fireEvent.click(view.getByRole("button", { name: "Update advance" }));
  await view.findByRole("status");
  expect(view.queryByRole("button", { name: /Customer 1/ })).not.toBeInTheDocument();
  await act(async () => refresh.reject(new Error("Refresh unavailable")));
  expect(view.getByRole("alert")).toHaveTextContent("Refresh unavailable");
  expect(view.queryByText(/No advances on file/)).not.toBeInTheDocument();
  vi.mocked(advances.list).mockResolvedValue([row(1, 30)]);
  fireEvent.click(view.getByRole("button", { name: "Retry advances" }));
  await view.findByRole("button", { name: /Customer 1/ });
});

it.each(["party", "dashboard"] as const)("%s advance entry rejects a non-finite imported amount before any mutation", async kind => {
  // Editing a malformed stored value also needs a guard: a numeric input can
  // hide Infinity while the controlled React draft still contains it.
  vi.mocked(advances.forParty).mockResolvedValue([row(1, Infinity)]);
  vi.mocked(advances.list).mockResolvedValue([row(1, Infinity)]);
  const view = render(kind === "party" ? <AdvanceCard partyType="customer" partyId={1} partyName="Customer 1" /> : <CustomerAdvancesPanel />);
  if (kind === "dashboard") fireEvent.click(await view.findByRole("button", { name: /Customer 1/ }));
  fireEvent.click(await view.findByRole("button", { name: "Edit advance" }));
  fireEvent.click(view.getByRole("button", { name: "Update advance" }));
  expect(ui.toast.error).toHaveBeenCalledWith("Enter a valid amount.");
  expect(advances.add).not.toHaveBeenCalled();
  expect(advances.update).not.toHaveBeenCalled();
});
