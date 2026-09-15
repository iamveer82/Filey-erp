import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MentionInput from "../MentionInput";
afterEach(cleanup);

it("labels the composer, exposes its active mention, and selects without posting",()=>{
  const posted=vi.fn();
  function Composer() { const [value,setValue]=useState("");return <div className="overflow-hidden dark"><MentionInput value={value} onChange={setValue} onEnter={posted} label="Team update" members={[{id:"a",name:"Amina"},{id:"b",name:"Bilal"},{id:"c",name:"أحمد"}]} /></div>; }
  render(<Composer/>);
  const input=screen.getByRole("combobox",{name:"Team update"});
  fireEvent.change(input,{target:{value:"@"}});
  const list=screen.getByRole("listbox");
  expect(list).toHaveAttribute("id",input.getAttribute("aria-controls"));
  expect(input).toHaveAttribute("aria-expanded","true");
  fireEvent.keyDown(input,{key:"ArrowDown"});
  expect(screen.getByRole("option",{name:/Bilal/})).toHaveAttribute("id",input.getAttribute("aria-activedescendant"));
  fireEvent.keyDown(input,{key:"Enter"});
  expect(input).toHaveValue("@Bilal ");
  expect(posted).not.toHaveBeenCalled();
  expect(input).toHaveAttribute("aria-expanded","false");
  fireEvent.change(input,{target:{value:"@أ"}});
  fireEvent.keyDown(input,{key:"Tab"});
  expect(input).toHaveValue("@أحمد ");
  fireEvent.keyDown(input,{key:"Enter"});
  expect(posted).toHaveBeenCalledOnce();
});
