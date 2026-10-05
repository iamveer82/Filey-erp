import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GuideLauncher from "../GuideLauncher";
import { agentStorageScope } from "../../lib/agentStorage";
import { setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import { loadGuideProgress } from "../../lib/guideProgress";

const fixture = vi.hoisted(() => ({
  loading: false, error: "", failNextChunk: false, denied: new Set<string>(), mount: vi.fn(), choose: vi.fn(), destroy: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, lazy: (load: Parameters<typeof actual.lazy>[0]) => actual.lazy(() => {
    if (fixture.failNextChunk) {
      fixture.failNextChunk = false;
      return Promise.reject(new Error("The guide chunk could not load."));
    }
    return load();
  }) };
});
vi.mock("../../lib/modules", () => ({ useModules: () => ({
  loading: fixture.loading, error: fixture.error,
  modules: [{ id: "invoicing", to: "/invoicing" }, { id: "orders", to: "/orders" }],
  isEnabled: (id: string) => !fixture.denied.has(id),
}) }));
vi.mock("../../lib/hairline/host", () => ({ mountGuideFigure: fixture.mount }));

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("guide-ui-fixture", "owner");
  fixture.loading = false; fixture.error = ""; fixture.failNextChunk = false; fixture.denied.clear();
  fixture.choose.mockReset(); fixture.destroy.mockReset();
  fixture.mount.mockReset().mockResolvedValue({ set: vi.fn(), choose: fixture.choose, destroy: fixture.destroy });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); setCacheOrg(null); });

function Workspace() {
  const [customer, setCustomer] = useState("Customer draft stays here");
  return <>
    <GuideLauncher />
    <label>Draft customer<input aria-label="Draft customer" data-guide="invoice-customer" value={customer} onChange={event => setCustomer(event.target.value)} /></label>
    <button type="button" data-guide="invoice-items">Invoice items editor</button>
    <Link to="/orders">Navigate to orders</Link>
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("filey:guide:open", { detail: { id: "invoices" } }))}>Read invoice guide</button>
  </>;
}

function setup(route = "/invoicing") {
  return render(<MemoryRouter initialEntries={[route]}><Workspace /></MemoryRouter>);
}

async function openGuide() {
  fireEvent.click(screen.getByRole("button", { name: "How this section works" }));
  return screen.findByRole("dialog", { name: "Create and collect an invoice" });
}

function visible(element: HTMLElement) {
  vi.spyOn(element, "getClientRects").mockReturnValue([{ width: 100, height: 30 }] as never);
}

it("keeps the business draft unchanged while reading, advancing and finishing a guide", async () => {
  setup();
  await openGuide();
  const input = screen.getByRole("textbox", { name: "Draft customer" });
  fireEvent.change(input, { target: { value: "Unsaved draft for my customer" } });
  for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish guide" }));
  expect(screen.getByRole("button", { name: "Reviewed" })).toBeDisabled();
  expect(input).toHaveValue("Unsaved draft for my customer");
  expect(loadGuideProgress(agentStorageScope()).invoices).toEqual({ step: 5, finished: true });
  expect(JSON.stringify(localStorage)).not.toContain("Unsaved draft for my customer");
});

it("keeps a found control highlighted through minimizing, then clears it on resume and account change", async () => {
  setup();
  await openGuide();
  const customer = screen.getByRole("textbox", { name: "Draft customer" });
  const items = screen.getByRole("button", { name: "Invoice items editor" });
  visible(customer); visible(items);
  fireEvent.click(screen.getByRole("button", { name: "Find this control" }));
  expect(screen.getByRole("button", { name: "Resume guide" })).toBeInTheDocument();
  expect(customer).toHaveAttribute("data-guide-highlight");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume guide" }));
  await screen.findByRole("dialog");
  expect(customer).not.toHaveAttribute("data-guide-highlight");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Find this control" }));
  expect(items).toHaveAttribute("data-guide-highlight");
  act(() => setCacheOrg("other-workspace", "other-owner"));
  expect(items).not.toHaveAttribute("data-guide-highlight");
  expect(screen.queryByRole("button", { name: "Resume guide" })).not.toBeInTheDocument();
});

it("clears highlighted controls when the user navigates to another section", async () => {
  setup(); await openGuide();
  const customer = screen.getByRole("textbox", { name: "Draft customer" });
  visible(customer);
  fireEvent.click(screen.getByRole("button", { name: "Find this control" }));
  expect(customer).toHaveAttribute("data-guide-highlight");
  fireEvent.click(screen.getByRole("link", { name: "Navigate to orders" }));
  expect(customer).not.toHaveAttribute("data-guide-highlight");
});

it("stops playback on A → B → A and never resumes stale guide progress", async () => {
  setup(); await openGuide();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const scope = agentStorageScope()!;
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Play guide" }));
  act(() => { setCacheOrg("another-workspace", "owner"); setCacheOrg("guide-ui-fixture", "owner"); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resume guide" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(40_000));
  expect(loadGuideProgress(scope).invoices).toEqual({ step: 1, finished: false });
});

it("allows reading an unavailable module guide without offering its navigation action", async () => {
  fixture.denied.add("invoicing"); setup("/docs");
  fireEvent.click(screen.getByRole("button", { name: "Read invoice guide" }));
  await screen.findByRole("dialog", { name: "Create and collect an invoice" });
  expect(screen.queryByRole("link", { name: "Open section" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Find this control" })).not.toBeInTheDocument();
  expect(screen.getByText(/This section is unavailable in your workspace/)).toBeInTheDocument();
});

it("does not open guide code while module permissions are loading or denied", () => {
  fixture.loading = true;
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Read invoice guide" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fixture.mount).not.toHaveBeenCalled();
  fixture.loading = false; fixture.error = "Permission verification failed";
  view.rerender(<MemoryRouter><Workspace /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Read invoice guide" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fixture.mount).not.toHaveBeenCalled();
});

it("returns keyboard focus to the actual header opener after the guide closes", async () => {
  setup();
  const opener = screen.getByRole("button", { name: "How this section works" });
  opener.focus(); await openGuide();
  const close = screen.getByRole("button", { name: "Close guide" });
  close.focus(); fireEvent.click(close);
  await waitFor(() => expect(opener).toHaveFocus());
});

it("returns keyboard focus to the Help Center opener when opened through its event", async () => {
  setup("/docs");
  const opener = screen.getByRole("button", { name: "Read invoice guide" });
  opener.focus(); fireEvent.click(opener);
  await screen.findByRole("dialog", { name: "Create and collect an invoice" });
  const close = screen.getByRole("button", { name: "Close guide" });
  close.focus(); fireEvent.click(close);
  await waitFor(() => expect(opener).toHaveFocus());
});

it("restores a connected opener after minimizing and resuming the guide", async () => {
  setup();
  const opener = screen.getByRole("button", { name: "How this section works" });
  await openGuide();
  fireEvent.click(screen.getByRole("button", { name: "Minimize guide" }));
  const resume = screen.getByRole("button", { name: "Resume guide" });
  expect(resume).toHaveFocus();
  fireEvent.click(resume);
  await screen.findByRole("dialog");
  const close = screen.getByRole("button", { name: "Close guide" });
  close.focus(); fireEvent.click(close);
  await waitFor(() => expect(opener).toHaveFocus());
});

it("restores the Help Center opener after its temporary header Resume control disappears", async () => {
  setup("/docs");
  const opener = screen.getByRole("button", { name: "Read invoice guide" });
  opener.focus(); fireEvent.click(opener);
  await screen.findByRole("dialog", { name: "Create and collect an invoice" });
  fireEvent.click(screen.getByRole("button", { name: "Minimize guide" }));
  const resume = screen.getByRole("button", { name: "Resume guide" });
  expect(resume).toHaveFocus(); fireEvent.click(resume);
  await screen.findByRole("dialog");
  const close = screen.getByRole("button", { name: "Close guide" });
  close.focus(); fireEvent.click(close);
  await waitFor(() => expect(opener).toHaveFocus());
});

it("can retry a failed lazy guide chunk when the user explicitly reopens it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.failNextChunk = true;
  setup();
  fireEvent.click(screen.getByRole("button", { name: "How this section works" }));
  await screen.findByText("This guide could not load.");
  expect(fixture.mount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close guide" }));
  await openGuide();
  expect(screen.queryByText("This guide could not load.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
});

it("lets the tray handle Escape while normal guide controls can still close the panel with Escape", async () => {
  fixture.mount.mockImplementation(async (stage: HTMLElement) => {
    stage.tabIndex = 0; stage.setAttribute("role", "group"); stage.setAttribute("aria-label", "Document tray");
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") event.preventDefault(); };
    stage.addEventListener("keydown", keydown);
    return { set: vi.fn(), choose: fixture.choose, destroy: () => stage.removeEventListener("keydown", keydown) };
  });
  setup(); await openGuide();
  const tray = await screen.findByRole("group", { name: "Document tray" });
  tray.focus(); fireEvent.keyDown(tray, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Create and collect an invoice" })).toBeInTheDocument();
  const close = screen.getByRole("button", { name: "Close guide" });
  close.focus(); fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("keeps the guide usable when the optional illustration cannot load", async () => {
  fixture.mount.mockRejectedValueOnce(new Error("Illustration unavailable"));
  setup(); await openGuide();
  await screen.findByText(/Illustration unavailable. The steps below still work./);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Draft customer" })).toHaveValue("Customer draft stays here");
});
