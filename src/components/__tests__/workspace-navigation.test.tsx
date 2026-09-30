import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceNavigation from "../WorkspaceNavigation";
import { MODULES } from "../../modules/registry";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

vi.mock("../../lib/i18n", () => ({ useLang: () => ({ t: (text: string) => text }) }));
vi.mock("../../modules/registry", async original => ({ ...(await original<typeof import("../../modules/registry")>()), prefetchModule: vi.fn() }));
vi.mock("../BloubBot", () => ({ default: () => <span data-testid="animated-assistant" /> }));

const modules = [
  { id: "agent", to: "/agent", label: "Filey AI", icon: "agent", desc: "Business assistant" },
  { id: "reports", to: "/reports", label: "Reports", icon: "reports", desc: "Reporting" },
  { id: "invoicing", to: "/invoicing", label: "Invoicing", icon: "invoicing", desc: "Create and edit invoices" },
  { id: "orders", to: "/orders", label: "Orders", icon: "orders", desc: "Sales orders" },
  { id: "settings", to: "/settings", label: "Settings", icon: "settings", desc: "Workspace preferences" },
];

it("keeps every permitted module reachable, including the browser panel", () => {
  render(<MemoryRouter><WorkspaceNavigation modules={MODULES} isDesktop mobileOpen={false} onNavigate={() => {}} /></MemoryRouter>);
  for (const module of MODULES) expect(screen.getByRole("link", { name: module.label })).toHaveAttribute("href", module.to);
  expect(screen.getByRole("navigation", { name: "Tools" })).toContainElement(screen.getByRole("link", { name: "Browser" }));
});

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

it("preserves collapsed sections when navigating to another section", () => {
  render(<MemoryRouter initialEntries={["/reports"]}>
    <WorkspaceNavigation modules={modules} isDesktop mobileOpen={false} onNavigate={() => {}} />
  </MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Sales" }));
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

it("keeps the filtered contents still during mobile closing and resets on reopening", () => {
  const navigation = (open: boolean) => <MemoryRouter initialEntries={["/settings"]}>
    <WorkspaceNavigation modules={modules} isDesktop={false} mobileOpen={open} onNavigate={() => {}} />
  </MemoryRouter>;
  const view = render(navigation(true));
  const search = screen.getByRole("textbox", { name: "Find a page" });
  fireEvent.change(search, { target: { value: "invoice" } });
  view.rerender(navigation(false));
  expect(search).toHaveValue("invoice");
  expect(screen.getByRole("link", { name: "Invoicing" })).toBeVisible();
  view.rerender(navigation(true));
  expect(search).toHaveValue("");
  expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
});

it("reveals the current page by scrolling only the navigation list", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  const { container } = render(<MemoryRouter initialEntries={["/settings"]}>
    <WorkspaceNavigation modules={modules} isDesktop={false} mobileOpen onNavigate={() => {}} />
  </MemoryRouter>);
  const list = container.querySelector<HTMLElement>(".workspace-nav-scroll")!;
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 120, bottom: 520 } as DOMRect);
  vi.spyOn(screen.getByRole("link", { name: "Settings" }), "getBoundingClientRect").mockReturnValue({ top: 700, bottom: 744 } as DOMRect);
  act(() => frames.forEach(frame => frame(0)));
  expect(list.scrollTop).toBe(224);
  expect(container.scrollTop).toBe(0);
  expect(container.scrollLeft).toBe(0);
});
