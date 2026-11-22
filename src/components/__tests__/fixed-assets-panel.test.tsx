import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider } from "../../lib/ui";
import * as fixedAssets from "../../lib/fixedAssets";
import FixedAssetsPanel from "../FixedAssetsPanel";

// Bought well in the past and never posted: there is depreciation waiting.
const van: fixedAssets.FixedAsset = {
  id: "11111111-aaaa-bbbb-cccc-000000000001", name: "Delivery van", category: "Vehicle",
  purchase_date: "2020-01-15", cost: 100_000, salvage: 10_000, life_months: 36, method: "straight_line",
};

beforeEach(() => {
  vi.spyOn(fixedAssets, "loadFixedAssets").mockResolvedValue([van]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (onPosted = vi.fn()) => render(<UIProvider><FixedAssetsPanel onPosted={onPosted} /></UIProvider>);

it("lists assets with what is not yet in the books and posts it after a yes", async () => {
  const post = vi.spyOn(fixedAssets, "postDepreciation").mockResolvedValue({ posted: [{ name: "Delivery van", amount: 90_000, from: "2020-01", to: "2022-12" }], total: 90_000 });
  const onPosted = vi.fn();
  mount(onPosted);
  expect(await screen.findByText("Delivery van")).toBeTruthy();
  expect(screen.getByText("Not posted")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Post depreciation/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Post" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onPosted).toHaveBeenCalled());
});

it("offers nothing to post when the books are up to date", async () => {
  vi.mocked(fixedAssets.loadFixedAssets).mockResolvedValue([{ ...van, posted_through: "2022-12" }]);
  mount();
  expect(await screen.findByText("Fully written off")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Post depreciation/ })).toBeNull();
});

it("shows the reason when the list cannot be read", async () => {
  vi.mocked(fixedAssets.loadFixedAssets).mockRejectedValue(new Error("The fixed assets list could not be read."));
  mount();
  expect(await screen.findByText("The fixed assets list could not be read.")).toBeTruthy();
});
