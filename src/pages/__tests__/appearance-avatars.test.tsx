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
  save.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it("keeps a custom personal avatar on save failure, retries it and supports returning to initials", async () => {
  save.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  render(
    <MemoryRouter>
      <UIProvider>
        <AccountProfile />
      </UIProvider>
    </MemoryRouter>
  );
  expect(screen.getByAltText("Profile photo")).toHaveAttribute("src", "data:image/webp;base64,example");
  fireEvent.click(screen.getByRole("button", { name: "Round shape" }));
  fireEvent.click(screen.getByRole("button", { name: "Rose colour" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByAltText("Profile photo")).toHaveAttribute("src", "/avatars/blobatar/round-rose.svg");
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByText("Could not save: Offline")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Round shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Rose colour" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatar: "/avatars/blobatar/round-rose.svg" })
    )
  );
  await screen.findByRole("button", { name: "Saved" });
  fireEvent.click(screen.getByRole("button", { name: "Use initials" }));
  expect(screen.queryByAltText("Profile photo")).not.toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(2);
});

it("preserves uploading a profile photo as an unsaved draft after choosing an avatar", async () => {
  const photo = "data:image/webp;base64,new-photo";
  const close = vi.fn();
  const draw = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2048, height: 1024, close })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ drawImage: draw }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(photo);
  const page = render(<MemoryRouter><UIProvider><AccountProfile /></UIProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Hexagon shape" }));
  fireEvent.click(screen.getByRole("button", { name: "Lilac colour" }));
  fireEvent.change(page.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(["fixture"], "my-photo.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByAltText("Profile photo")).toHaveAttribute("src", photo));
  expect(draw).toHaveBeenCalledWith(expect.any(Object), 0, 0, 512, 256);
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Hexagon shape" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ avatar: photo })));
});
