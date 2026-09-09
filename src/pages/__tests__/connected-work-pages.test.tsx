import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import WorkspaceBrowser from "../WorkspaceBrowser";
import WorkServices from "../../components/WorkServices";
import * as browser from "../../lib/desktopBrowser";
import * as services from "../../lib/workServices";

vi.mock("../../lib/desktopBrowser", () => ({
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
  vi.mocked(browser.desktopBrowserSupported).mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens social websites as an explicit browser fallback and reports blocked popups", () => {
  const popup = { opener: {} };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as Window);
  render(
    <MemoryRouter>
      <WorkspaceBrowser />
    </MemoryRouter>
  );
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open Instagram" }));
  expect(open).toHaveBeenCalledWith("https://www.instagram.com/", "_blank");
  expect(popup.opener).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Opened in your browser");
  open.mockReturnValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Open WhatsApp Web" }));
  expect(screen.getByText(/blocked the new tab/)).toBeInTheDocument();
  expect(browser.desktopBrowserCommand).not.toHaveBeenCalled();
});

it("shows actual native window state and sends controls with that window's ID", async () => {
  vi.mocked(browser.desktopBrowserSupported).mockReturnValue(true);
  const tab = {
    id: "filey-browser-example",
    title: "Instagram",
    url: "https://www.instagram.com/",
    loading: false,
    window_id: "123",
    canGoBack: false,
    canGoForward: true,
    warning: "Download blocked.",
  };
  vi.mocked(browser.desktopBrowserCommand).mockResolvedValue({ tabs: [tab] });
  render(
    <MemoryRouter>
      <WorkspaceBrowser />
    </MemoryRouter>
  );
  await screen.findByRole("button", { name: "Reload Instagram" });
  expect(screen.getByRole("button", { name: "Back Instagram" })).toBeDisabled();
  expect(screen.getByText("Download blocked.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload Instagram" }));
  await waitFor(() =>
    expect(browser.desktopBrowserCommand).toHaveBeenCalledWith(
      { action: "reload", tab_id: tab.id, url: undefined },
      expect.any(AbortSignal)
    )
  );
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
