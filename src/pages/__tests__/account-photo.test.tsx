import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccountProfile from "../settings/AccountProfile";
const fixture = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ profile: { name: "Test User", email: "test@example.invalid" }, updateProfile: fixture.save }) }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { error: fixture.error, success: vi.fn() } }) }));
vi.mock("../../lib/supabase", () => ({ supabase: null, cloudConfigured: false }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("bounds a large avatar before saving and preserves other fields edited while decoding", async () => {
  let resolve!: (image: unknown) => void;
  const bitmap = { width: 2400, height: 1200, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(r => { resolve = r; })));
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
    expect([this.width, this.height]).toEqual([512, 256]);
    return "data:image/webp;base64,small";
  });
  const { container } = render(<AccountProfile />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
  fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: "Updated name" } });
  resolve(bitmap);
  await waitFor(() => expect(screen.getByAltText("Profile photo")).toHaveAttribute("src", "data:image/webp;base64,small"));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Updated name", avatar: "data:image/webp;base64,small" })));
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it("reports an unreadable photo without pretending it was uploaded", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("Bad image")));
  const { container } = render(<AccountProfile />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["bad"], "photo.png", { type: "image/png" })] } });
  await waitFor(() => expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining("Could not read")));
  expect(screen.queryByAltText("Profile photo")).toBeNull();
  expect(fixture.save).not.toHaveBeenCalled();
});
