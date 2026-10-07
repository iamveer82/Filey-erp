import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileAvatarImage } from "../ProfileAvatarImage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reacts without intercepting the account button and returns to the static portrait for reduced motion", async () => {
  vi.useFakeTimers();
  const motion = Object.assign(new EventTarget(), { matches: true });
  const pointer = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", (query: string) =>
    query.includes("reduced-motion") ? motion : pointer
  );
  const open = vi.fn();
  const view = render(
    <button onClick={open}>
      <ProfileAvatarImage animate src="/avatars/mascots/fox.webp" alt="Profile" />
    </button>
  );
  const portrait = screen.getByAltText("Profile");
  const layer = view.container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 80,
    height: 80,
    bottom: 80,
  } as DOMRect);
  const sheets = Array.from(layer.querySelectorAll("img"));
  expect(sheets).toHaveLength(2);
  sheets.forEach((image) => fireEvent.load(image));
  fireEvent(window, new MouseEvent("pointermove", { clientX: 250, clientY: 40 }));
  act(() => vi.advanceTimersByTime(20));
  expect(sheets[0]).toHaveStyle({ left: "-200%", top: "-100%" });
  fireEvent.pointerDown(layer);
  fireEvent.click(layer);
  expect(open).toHaveBeenCalledOnce();
  expect(sheets[1]).toHaveAttribute("data-visible", "true");
  act(() => vi.advanceTimersByTime(600));
  expect(sheets[0]).toHaveAttribute("data-visible", "true");
  act(() => {
    motion.matches = false;
    motion.dispatchEvent(new Event("change"));
  });
  expect(layer.querySelectorAll("img")).toHaveLength(0);
  expect(portrait).toHaveAttribute("src", "/avatars/mascots/fox.webp");
  view.rerender(
    <ProfileAvatarImage animate src="/avatars/mascots/cat.webp" alt="Profile" />
  );
  expect(screen.getByAltText("Profile")).toHaveAttribute(
    "src",
    "/avatars/mascots/cat.webp"
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
});

it("keeps photos and list avatars as ordinary images without loading sprite sheets", () => {
  const view = render(
    <ProfileAvatarImage src="/avatars/mascots/fox.webp" alt="Team member" />
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  view.rerender(
    <ProfileAvatarImage animate src="data:image/webp;base64,photo" alt="Team member" />
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  expect(screen.getByAltText("Team member")).toHaveAttribute(
    "src",
    "data:image/webp;base64,photo"
  );
});
