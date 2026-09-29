import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MenuItemRow, MenuPopover, SelectMenu } from "../ui-menu";
import { Modal } from "../ui";

afterEach(cleanup);

it("focuses the selected option and closes without rewriting an unchanged value", async () => {
  const change = vi.fn();
  const view = render(<SelectMenu value="second" ariaLabel="Template" onChange={change} options={[{value:"first",label:"Corporate"},{value:"second",label:"Minimal"}]} />);
  fireEvent.click(screen.getByRole("button", {name:"Template"}));
  const selected = screen.getByRole("menuitem", {name:"Minimal"});
  await waitFor(() => expect(selected).toHaveFocus());
  fireEvent.click(selected);
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"Template"}));
  view.rerender(<SelectMenu disabled value="second" ariaLabel="Template" onChange={change} options={[]} />);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("filters grouped options, preserves the selection and supports keyboard dismissal", async () => {
  const change = vi.fn();
  render(<SelectMenu id="provider" ariaLabel="Provider" value="ollama" onChange={change}
    searchPlaceholder="Search providers…" options={[
      { value: "ollama", label: "Ollama", group: "On this device" },
      { value: "openai", label: "OpenAI", group: "Bring your own key" },
    ]} />);
  const trigger = screen.getByRole("button", { name: "Provider" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const search = screen.getByRole("textbox", { name: "Search providers…" });
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matching options");
  expect(trigger).toHaveTextContent("Ollama");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: "open" } });
  expect(screen.queryByRole("menuitem", { name: "Ollama" })).not.toBeInTheDocument();
  expect(fireEvent.keyDown(search, { key: "Home" })).toBe(true);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  const option = screen.getByRole("menuitem", { name: "OpenAI" });
  expect(option).toHaveFocus();
  fireEvent.click(option);
  expect(change).toHaveBeenCalledExactlyOnceWith("openai");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  fireEvent.click(trigger);
  expect(screen.getByRole("textbox")).toHaveValue("");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(trigger).toHaveFocus();
});

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
