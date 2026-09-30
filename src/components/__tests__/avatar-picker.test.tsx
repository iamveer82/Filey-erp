import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AvatarPicker from "../AvatarPicker";
import { AVATAR_COLOURS, AVATAR_SHAPES, avatarChoice, avatarUrl } from "../../lib/profileAvatars";

afterEach(cleanup);

it("recognizes the original avatars and every custom pairing without treating photos or malformed URLs as choices", () => {
  expect(AVATAR_SHAPES).toHaveLength(10);
  expect(AVATAR_COLOURS).toHaveLength(10);
  for (const shape of AVATAR_SHAPES) {
    expect(avatarChoice(`/avatars/${shape.legacy}.svg`)).toMatchObject({
      shape: { id: shape.id }, colour: { id: shape.colour },
    });
    for (const colour of AVATAR_COLOURS) {
      expect(avatarChoice(avatarUrl(shape.id, colour.id))).toMatchObject({
        shape: { id: shape.id }, colour: { id: colour.id },
      });
    }
  }
  for (const value of ["", "data:image/webp;base64,photo", "https://example.invalid/photo.png", "/avatars/blobatar/unknown-mint.svg", "/avatars/blobatar/round-unknown.svg", "/avatars/blobatar/round-mint.svg\n"]) {
    expect(avatarChoice(value)).toBeNull();
  }
});

it("keeps colour when changing shape and keeps shape when changing colour", () => {
  const change = vi.fn();
  const page = render(<AvatarPicker value="/avatars/mint.svg" onChange={change} />);
  expect(within(screen.getByRole("group", { name: "Avatar shape" })).getAllByRole("button")).toHaveLength(10);
  expect(within(screen.getByRole("group", { name: "Avatar colour" })).getAllByRole("button")).toHaveLength(10);
  expect(screen.getByRole("button", { name: "Organic shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mint colour" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Sunburst shape" }));
  expect(change).toHaveBeenLastCalledWith("/avatars/blobatar/sunburst-mint.svg");
  page.rerender(<AvatarPicker value="/avatars/blobatar/sunburst-mint.svg" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Rose colour" }));
  expect(change).toHaveBeenLastCalledWith("/avatars/blobatar/sunburst-rose.svg");
  page.rerender(<AvatarPicker value="/avatars/blobatar/sunburst-rose.svg" onChange={change} />);
  expect(screen.getByRole("button", { name: "Sunburst shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Rose colour" })).toHaveAttribute("aria-pressed", "true");
  expect(change).toHaveBeenCalledTimes(2);
});

it("preserves a photo until reset is requested and reflects external profile changes without overwriting them", () => {
  const change = vi.fn();
  const photo = "data:image/webp;base64,existing-photo";
  const props = { onChange: change, resetLabel: "Use profile photo or initials" };
  const page = render(<AvatarPicker value={photo} {...props} />);
  const selected = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");
  expect(selected()).toHaveLength(0);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use profile photo or initials" }));
  expect(change).toHaveBeenCalledExactlyOnceWith("");
  page.rerender(<AvatarPicker value="" {...props} />);
  expect(selected()).toEqual([screen.getByRole("button", { name: "Use profile photo or initials" })]);
  page.rerender(<AvatarPicker value="/avatars/blobatar/triangle-slate.svg" {...props} />);
  expect(screen.getByRole("button", { name: "Triangle shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Slate colour" })).toHaveAttribute("aria-pressed", "true");
  page.rerender(<AvatarPicker value={photo} {...props} />);
  expect(selected()).toHaveLength(0);
  expect(change).toHaveBeenCalledTimes(1);
});
