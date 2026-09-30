import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { UIProvider } from "../../lib/ui";
import KnowledgeCenter, { GUIDES } from "../KnowledgeCenter";
import { MODULES } from "../../modules/registry";

vi.mock("../../lib/localPaths", () => ({ downloadText: vi.fn(async () => {}) }));
afterEach(cleanup);
const open = (path = "/docs") => render(<MemoryRouter initialEntries={[path]}><UIProvider><KnowledgeCenter /></UIProvider></MemoryRouter>);

it("links guides to sections that exist in the app", () => {
  const routes = new Set(MODULES.map(module => module.to));
  for (const guide of GUIDES) expect(routes.has(guide.to.split("?")[0]), guide.id).toBe(true);
  expect(new Set(GUIDES.map(guide => guide.id)).size).toBe(GUIDES.length);
});

it("searches trimmed queries and exposes an empty result on narrow screens too", () => {
  open();
  const search = screen.getByRole("textbox", { name: "Search help articles" });
  fireEvent.change(search, { target: { value: "  reconciliation  " } });
  expect(screen.getByRole("heading", { name: "Bank details, reconciliation and cheques" })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "unmatched-fixture-query" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matching guides");
  expect(screen.getByRole("status").closest("nav")).toBeNull();
});

it("opens a guide from the shared mobile picker and keeps its section link", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Choose a help article" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Cloud, offline mode and backups/ }));
  expect(screen.getByRole("heading", { name: "Cloud, offline mode and backups" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open section" })).toHaveAttribute("href", "/settings?section=datamode");
  expect(screen.getByText(/turn Store in my Filey account on to upload/)).toBeInTheDocument();
  expect(screen.getByText(/Turn the switch off to save the latest cloud records and files/)).toBeInTheDocument();
});

it("describes the real browser availability and distinguishes XML export from submission", () => {
  const browser = GUIDES.find(guide => guide.id === "browser")!;
  expect(browser.steps.join(" ")).toContain("collapsible browser panel");
  expect(browser.steps.join(" ")).toContain("cannot control another browser tab");
  open("/docs?article=invoices");
  expect(screen.getByText(/Choose Check e-invoice in the main toolbar/)).toBeInTheDocument();
  expect(screen.getByText(/network submission requires a configured accredited provider/)).toBeInTheDocument();
});

it("explains desktop credential storage and the browser key lifetime", () => {
  open("/docs?article=ai-setup");
  expect(screen.getByText(/operating system's credential store/)).toHaveTextContent("your signed-in account and workspace");
  expect(screen.getByText(/Web and mobile keys stay in memory until the page reloads/)).toBeInTheDocument();
  expect(screen.queryByText(/without application-level encryption/)).toBeNull();
});
