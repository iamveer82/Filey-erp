import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
const data = vi.hoisted(() => ({ customers: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api", () => ({ crm: { customers: data.customers, leads: async () => [], opportunities: async () => [] } }));
vi.mock("../../lib/modules", () => ({ useModules: () => ({ modules: [], isEnabled: () => true }) }));
import CommandPalette from "../CommandPalette";
function Location() { return <output>{useLocation().pathname}</output>; }
afterEach(cleanup);
it("Enter opens the first real command and searches newly added records on reopening", async () => {
  data.customers.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 31, name: "New Customer", company: "New Company" }]);
  render(<MemoryRouter><Location /><CommandPalette /></MemoryRouter>);
  fireEvent(window, new Event("toggle-command-palette"));
  await screen.findByRole("dialog", { name: "Search workspace" });
  fireEvent.keyDown(screen.getByLabelText("Search pages, customers, deals"), { key: "Enter" });
  await waitFor(() => expect(screen.getByText("/invoicing")).toBeInTheDocument());
  fireEvent(window, new Event("toggle-command-palette"));
  fireEvent.change(screen.getByLabelText("Search pages, customers, deals"), { target: { value: "New Customer" } });
  await screen.findByRole("button", { name: /New Customer/ });
  expect(data.customers).toHaveBeenCalledTimes(2);
});
