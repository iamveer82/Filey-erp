import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MenuItemRow, MenuPopover } from "../ui-menu";

afterEach(cleanup);

it("Escape closes the menu without dismissing its parent drawer and restores trigger focus", () => {
  function Example() {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return <>
      <button ref={anchor} onClick={() => setOpen(true)}>Account menu</button>
      <MenuPopover open={open} onClose={() => setOpen(false)} anchorRef={anchor}>
        <MenuItemRow label="Account" onClick={() => {}} />
      </MenuPopover>
    </>;
  }
  const parentEscape = vi.fn();
  window.addEventListener("keydown", parentEscape);
  try {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "Account" });
    item.focus();
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(parentEscape).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  } finally {
    window.removeEventListener("keydown", parentEscape);
  }
});
