import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { getPersona } from "../../lib/ai";
import AppearancePanel from "../settings/AppearancePanel";
import AccountProfile from "../settings/AccountProfile";

const save = vi.hoisted(() => vi.fn());
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    profile: { name: "Sample User", avatar: "data:image/webp;base64,example" },
    updateProfile: save,
  }),
}));
vi.mock("../../lib/supabase", () => ({ supabase: null, cloudConfigured: false }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

it("selects and restores the assistant's look and motion through Appearance", () => {
  const page = render(
    <UIProvider>
      <AppearancePanel />
    </UIProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Cloud" }));
  fireEvent.click(screen.getByRole("button", { name: "Still" }));
  expect(getPersona()).toMatchObject({ botShape: "nuage", botMotion: "still" });
  page.unmount();
  render(
    <UIProvider>
      <AppearancePanel />
    </UIProvider>
  );
  expect(screen.getByRole("button", { name: "Cloud" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(screen.getByRole("button", { name: "Still" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

it("keeps a personal avatar as a draft until Save Changes and supports returning to initials", async () => {
  render(
    <MemoryRouter>
      <UIProvider>
        <AccountProfile />
      </UIProvider>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "Sun avatar" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByAltText("Profile photo")).toHaveAttribute("src", "/avatars/sun.svg");
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: "/avatars/sun.svg" })
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Use initials" }));
  expect(screen.queryByAltText("Profile photo")).not.toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);
});
