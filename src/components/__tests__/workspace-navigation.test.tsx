import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceNavigation from "../WorkspaceNavigation";
afterEach(cleanup);

vi.mock("../../lib/i18n", () => ({ useLang: () => ({ t: (text: string) => text }) }));
vi.mock("../../modules/registry", () => ({ prefetchModule: vi.fn() }));
vi.mock("../BloubBot", () => ({ default: () => <span data-testid="animated-assistant" /> }));

const modules = [
  { id: "agent", to: "/agent", label: "Filey AI", icon: "agent", desc: "Business assistant" },
  { id: "reports", to: "/reports", label: "Reports", icon: "reports", desc: "Reporting" },
  { id: "invoicing", to: "/invoicing", label: "Invoicing", icon: "invoicing", desc: "Create and edit invoices" },
  { id: "orders", to: "/orders", label: "Orders", icon: "orders", desc: "Sales orders" },
  { id: "settings", to: "/settings", label: "Settings", icon: "settings", desc: "Workspace preferences" },
];

it("opens the current mobile section, preserves the assistant, and closes after selecting the same page", () => {
  const close = vi.fn();
  render(<MemoryRouter initialEntries={["/invoicing"]}>
    <WorkspaceNavigation modules={modules} isDesktop={false} mobileOpen onNavigate={close} />
  </MemoryRouter>);
  expect(screen.getByTestId("animated-assistant")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-expanded", "false");
  const invoice = screen.getByRole("link", { name: "Invoicing" });
  expect(invoice).toHaveAttribute("aria-current", "page");
  fireEvent.click(invoice);
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "System" }));
  expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
});

it("finds pages inside collapsed groups, only from permitted modules, and clears the filter", () => {
  render(<MemoryRouter initialEntries={["/settings"]}>
    <WorkspaceNavigation modules={modules} isDesktop={false} mobileOpen onNavigate={() => {}} />
  </MemoryRouter>);
  const search = screen.getByRole("textbox", { name: "Find a page" });
  expect(screen.queryByRole("link", { name: "Invoicing" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "invoice" } });
  expect(screen.getByRole("link", { name: "Invoicing" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "sales" } });
  expect(screen.getByRole("link", { name: "Orders" })).toBeVisible();
  fireEvent.change(search, { target: { value: "CRM" } });
  expect(screen.getByRole("status")).toHaveTextContent("No pages found");
  fireEvent.click(screen.getByRole("button", { name: "Clear page search" }));
  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
});

it("keeps desktop groups expanded while allowing compact navigation", () => {
  render(<MemoryRouter initialEntries={["/reports"]}>
    <WorkspaceNavigation modules={modules} isDesktop mobileOpen={false} onNavigate={() => {}} />
  </MemoryRouter>);
  expect(screen.getByRole("link", { name: "Invoicing" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sales" }));
  expect(screen.queryByRole("link", { name: "Invoicing" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
});
