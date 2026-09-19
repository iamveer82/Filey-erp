import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BrowserPanel from "../../components/BrowserPanel";
import WorkServices from "../../components/WorkServices";
import * as browser from "../../lib/desktopBrowser";
import * as services from "../../lib/workServices";

vi.mock("../../lib/desktopBrowser", async original => ({
  ...(await original<typeof import("../../lib/desktopBrowser")>()),
  desktopBrowserSupported: vi.fn(() => false),
  desktopBrowserCommand: vi.fn(),
}));
vi.mock("../../lib/workServices", async (original) => ({
  ...(await original<typeof import("../../lib/workServices")>()),
  getCountryMarketData: vi.fn(),
  getPublicHolidays: vi.fn(),
  listHolidayCountries: vi.fn(),
  searchCreativeAssets: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  browser.setBrowserPanelOpen(true);
  vi.mocked(browser.desktopBrowserSupported).mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the browser in a collapsible panel without opening a popup", () => {
  const open = vi.spyOn(window, "open");
  render(<BrowserPanel />);
  expect(screen.getByLabelText("Website address")).toBeDisabled();
  expect(screen.getByText(/available in the Windows desktop app/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Collapse browser" }));
  expect(browser.getBrowserPanelState().open).toBe(false);
  expect(open).not.toHaveBeenCalled();
});

it("runs keyless lookups only on request and preserves image attribution", async () => {
  vi.mocked(services.searchCreativeAssets).mockResolvedValue({
    query: "coffee",
    rows: [
      {
        id: "1",
        title: "Coffee beans",
        imageUrl: "https://upload.wikimedia.org/coffee.jpg",
        thumbnailUrl: "https://upload.wikimedia.org/thumb.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Coffee.jpg",
        creator: "Photographer",
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "Coffee beans — Photographer, CC BY 4.0",
      },
    ],
    sourceUrl: "https://commons.wikimedia.org",
    attribution: "Wikimedia Commons",
  });
  render(
    <MemoryRouter>
      <WorkServices />
    </MemoryRouter>
  );
  expect(services.getCountryMarketData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Creative assets" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Creative asset search" }), {
    target: { value: "coffee" },
  });
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Creative asset search" }).closest("form")!
  );
  expect(
    await screen.findByText("Coffee beans — Photographer, CC BY 4.0")
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/"
  );
  expect(services.searchCreativeAssets).toHaveBeenCalledWith("coffee", {
    limit: 6,
    signal: expect.any(AbortSignal),
  });
});
