import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BrowserPanel from "../BrowserPanel";

const browser = vi.hoisted(() => ({
  state: { open: true, tabs: [], activeId: null, paused: false, agentId: null },
  setOpen: vi.fn(),
}));
vi.mock("../../lib/desktopBrowser", () => ({
  getBrowserPanelState: () => browser.state,
  subscribeBrowserPanel: () => () => {},
  desktopBrowserSupported: () => false,
  setBrowserPanelOpen: browser.setOpen,
}));

beforeEach(() => {
  localStorage.clear();
  browser.setOpen.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const panelWidth = this.style.getPropertyValue("--filey-browser-width");
    const width = this.tagName === "ASIDE" ? (panelWidth.endsWith("%") ? 1200 * Number.parseFloat(panelWidth) / 100 : Number.parseFloat(panelWidth) || 480) : 1200;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 700, right: width, width, height: 700, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("announces the actual percentage-based panel width before a size is saved", () => {
  render(<BrowserPanel />);
  expect(screen.getByRole("separator", { name: "Resize browser panel" })).toHaveAttribute("aria-valuenow", "528");
});

it("resizes the browser with arrow keys, bounds its width and remembers it", () => {
  localStorage.setItem("filey.browser.panel.width", "480");
  const view = render(<BrowserPanel />);
  const separator = screen.getByRole("separator", { name: "Resize browser panel" });
  expect(separator).toHaveAttribute("aria-controls", "filey-browser-panel");
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(separator).toHaveAttribute("aria-valuenow", "504");
  expect(localStorage.getItem("filey.browser.panel.width")).toBe("504");
  fireEvent.keyDown(separator, { key: "End" });
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(separator).toHaveAttribute("aria-valuenow", "760");
  fireEvent.keyDown(separator, { key: "Home" });
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(separator).toHaveAttribute("aria-valuenow", "320");
  fireEvent.keyDown(separator, { key: "Enter" });
  expect(browser.setOpen).toHaveBeenCalledWith(false);
  view.unmount();
  render(<BrowserPanel />);
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "320");
});

it("keeps the collapse action available independently of resizing", () => {
  render(<BrowserPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse browser" }));
  expect(browser.setOpen).toHaveBeenCalledWith(false);
  expect(screen.getByRole("complementary", { name: "Built-in browser" })).toBeInTheDocument();
});

it("drags the separator and shields the native browser until the pointer is released", () => {
  localStorage.setItem("filey.browser.panel.width", "480");
  const { container } = render(<BrowserPanel />);
  const separator = screen.getByRole("separator", { name: "Resize browser panel" });
  separator.setPointerCapture = vi.fn();
  separator.hasPointerCapture = () => true;
  separator.releasePointerCapture = vi.fn();
  fireEvent(separator, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 800 }));
  expect(container.querySelector("[data-browser-overlay]")).toBeInTheDocument();
  fireEvent(separator, new MouseEvent("pointermove", { bubbles: true, clientX: 700 }));
  expect(separator).toHaveAttribute("aria-valuenow", "580");
  fireEvent(separator, new MouseEvent("pointerup", { bubbles: true }));
  expect(container.querySelector("[data-browser-overlay]")).not.toBeInTheDocument();
  expect(separator.releasePointerCapture).toHaveBeenCalled();
});
