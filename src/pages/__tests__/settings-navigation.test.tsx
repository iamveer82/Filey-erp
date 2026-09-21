import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import Settings from "../settings";
afterEach(cleanup);
vi.mock("../settings/BillingPanel", () => ({ default: () => <h2>Plan and device management</h2> }));

vi.mock("../settings/CompanyDetails", () => ({
  default: () => <input aria-label="Unsaved company name" defaultValue="" />,
}));
vi.mock("../settings/AppearancePanel", () => ({
  default: () => <h2>Display preferences</h2>,
}));
vi.mock("../settings/SecurityPanel", () => ({
  default: () => null,
  ChangePasswordModal: () => null,
}));

function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.search}</output>
    <button onClick={() => navigate("/settings")}>Settings home</button>
  </>;
}

it("keeps drafts across horizontal tabs and follows keyboard and URL navigation", async () => {
  render(<MemoryRouter initialEntries={["/settings?section=company"]}>
    <Settings /><LocationControls />
  </MemoryRouter>);
  expect(screen.getByRole("tablist", { name: "Settings sections" })).toHaveAttribute("aria-orientation", "horizontal");
  fireEvent.change(await screen.findByLabelText("Unsaved company name"), { target: { value: "Unsaved draft" } });
  const appearance = screen.getByRole("tab", { name: "Appearance" });
  fireEvent.mouseDown(appearance, { button: 0, ctrlKey: false });
  expect(screen.getByTestId("location")).toHaveTextContent("section=appearance");
  expect(screen.getByRole("tabpanel", { name: "Appearance" })).toBeVisible();
  expect(screen.getByLabelText("Unsaved company name")).not.toBeVisible();
  act(() => appearance.focus());
  fireEvent.keyDown(appearance, { key: "Home" });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Company Details" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByLabelText("Unsaved company name")).toHaveValue("Unsaved draft");
  fireEvent.mouseDown(appearance, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: "Settings home" }));
  expect(screen.getByRole("tab", { name: "Company Details" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("Unsaved company name")).toHaveValue("Unsaved draft");
});

it("routes old desktop license links into billing and makes the wallet discoverable", async () => {
  render(<MemoryRouter initialEntries={["/settings?section=license&checkout=success"]}><Settings /><LocationControls /></MemoryRouter>);
  await screen.findByText("Plan and device management");
  expect(screen.queryByRole("tab", { name: "Desktop License" })).toBeNull();
  expect(screen.getByRole("tab", { name: "AI Wallet" })).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent("section=billing&checkout=success&plan=ultra");
});
