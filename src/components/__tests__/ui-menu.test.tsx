import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MenuItemRow, MenuPopover, SelectMenu } from "../ui-menu";
import { Modal } from "../ui";

afterEach(cleanup);

it("keeps dialog menus interactive and keyboard focus inside the active menu", async () => {
  function Example() {
    const [value,setValue]=useState('chat');
    return <Modal open onClose={()=>{}} title="Approve teammate"><SelectMenu ariaLabel="App access" value={value} onChange={setValue}
      options={[{value:'chat',label:'Team chat'},{value:'sales',label:'Sales'}]}/></Modal>;
  }
  render(<Example/>);
  fireEvent.click(screen.getByRole('button',{name:'App access'}));
  const first=screen.getByRole('menuitem',{name:'Team chat'});
  await waitFor(()=>expect(first).toHaveFocus());
  expect(screen.getByRole('menu')).toHaveStyle({pointerEvents:'auto'});
  fireEvent.keyDown(first,{key:'ArrowDown'});
  expect(screen.getByRole('menuitem',{name:'Sales'})).toHaveFocus();
  fireEvent.click(screen.getByRole('menuitem',{name:'Sales'}));
  expect(screen.getByRole('dialog',{name:'Approve teammate'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'App access'})).toHaveTextContent('Sales');
});

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
