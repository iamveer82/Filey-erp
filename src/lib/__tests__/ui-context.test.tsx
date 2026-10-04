import { StrictMode, useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider, useUI } from "../ui";
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("settles replaced confirmations instead of leaving the first caller busy forever", async () => {
 let ui!: ReturnType<typeof useUI>;
 function Page(){ui=useUI();return null;}
 render(<UIProvider><Page/></UIProvider>);
 let first!: Promise<boolean>, second!: Promise<boolean>;
 act(()=>{first=ui.confirm({title:"First action"});second=ui.confirm({title:"Second action"});});
 expect(await first).toBe(false);
 expect(screen.queryByRole("alertdialog",{name:"First action"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Confirm"}));
 expect(await second).toBe(true);
});

it("cancels a replaced prompt, resets its draft and never stacks it with a confirmation", async () => {
 let ui!: ReturnType<typeof useUI>;
 function Page(){ui=useUI();return null;}
 render(<UIProvider><Page/></UIProvider>);
 let first!: Promise<string|null>, second!: Promise<string|null>, confirm!: Promise<boolean>;
 act(()=>{first=ui.prompt({title:"Column name",defaultValue:"Original"});});
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"Old draft"}});
 act(()=>{second=ui.prompt({title:"Column name",defaultValue:"New field"});});
 expect(await first).toBe(null); expect(screen.getByRole("textbox")).toHaveValue("New field");
 act(()=>{confirm=ui.confirm({title:"Confirm current action"});});
 expect(await second).toBe(null); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
 expect(await confirm).toBe(false);
});

it("settles pending modal promises safely when the app provider unmounts", async () => {
 let ui!: ReturnType<typeof useUI>;
 function Page(){ui=useUI();return null;}
 const view=render(<UIProvider><Page/></UIProvider>);
 let pending!: Promise<boolean>;
 act(()=>{pending=ui.confirm({title:"Pending action"});});
 view.unmount(); expect(await pending).toBe(false);
});
it("keeps notification callbacks stable so failed-load effects do not repeat",()=>{
 const load=vi.fn();
 function Page(){const {toast}=useUI();useEffect(()=>{load();},[toast]);return <button onClick={()=>toast.error("Fixture error")}>Notify</button>;}
 render(<UIProvider><Page/></UIProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Notify"}));
 expect(screen.getByText("Fixture error")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Dismiss"}));
 expect(load).toHaveBeenCalledOnce();
});
it("provides a keyboard reachable notification link while dismissal leaves the current route alone", () => {
 function Page(){const {toast}=useUI();return <button onClick={()=>toast.notify({title:"New reply",message:"Open the conversation",to:"/team"})}>Notify</button>;}
 render(<UIProvider><Page/></UIProvider>);
 const hash=window.location.hash;
 fireEvent.click(screen.getByRole("button",{name:"Notify"}));
 const link=screen.getByRole("link",{name:"New reply Open the conversation"});
 expect(link).toHaveAttribute("href","#/team");link.focus();expect(link).toHaveFocus();
 fireEvent.click(screen.getByRole("button",{name:"Dismiss"}));
 expect(window.location.hash).toBe(hash);expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("clears toast timers after dismissal or unmount and preserves automatic expiry", () => {
 vi.useFakeTimers();
 function Page(){const {toast}=useUI();return <button onClick={()=>toast.info("Fixture toast")}>Notify</button>;}
 const view=render(<UIProvider><Page/></UIProvider>);
 const baseline=vi.getTimerCount();
 const notify=screen.getByRole("button",{name:"Notify"});
 fireEvent.click(notify);
 expect(vi.getTimerCount()).toBe(baseline+1);
 fireEvent.click(screen.getByRole("button",{name:"Dismiss"}));
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 expect(vi.getTimerCount()).toBe(baseline);
 fireEvent.click(notify);
 act(()=>{vi.advanceTimersByTime(3999);});
 expect(screen.getByRole("status")).toHaveTextContent("Fixture toast");
 fireEvent.click(notify);
 act(()=>{vi.advanceTimersByTime(1);});
 expect(screen.getAllByRole("status")).toHaveLength(1);
 act(()=>{vi.advanceTimersByTime(3999);});
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 expect(vi.getTimerCount()).toBe(baseline);
 fireEvent.click(notify);
 fireEvent.click(notify);
 expect(vi.getTimerCount()).toBe(baseline+2);
 view.unmount();
 expect(vi.getTimerCount()).toBe(baseline);
 function MountedToast(){const {toast}=useUI();useEffect(()=>{toast.info("Mount toast");},[toast]);return null;}
 const strict=render(<StrictMode><UIProvider><MountedToast/></UIProvider></StrictMode>);
 act(()=>{vi.advanceTimersByTime(3999);});
 expect(screen.getAllByText("Mount toast").length).toBeGreaterThan(0);
 act(()=>{vi.advanceTimersByTime(1);});
 expect(screen.queryAllByRole("status")).toHaveLength(0);
 strict.unmount();
 expect(vi.getTimerCount()).toBe(baseline);
});
it("focuses cancel in a destructive confirmation and denies an Escape dismissal", async () => {
 const result=vi.fn();
 function Page(){const {confirm}=useUI();return <button onClick={()=>void confirm({title:"Remove sample?",message:"This is a preview only.",confirmLabel:"Remove",danger:true}).then(result)}>Preview confirmation</button>;}
 render(<UIProvider><Page/></UIProvider>);
 const trigger=screen.getByRole("button",{name:"Preview confirmation"});
 trigger.focus();
 fireEvent.click(trigger);
 const dialog=screen.getByRole("alertdialog",{name:"Remove sample?"});
 expect(dialog).toHaveAccessibleDescription("This is a preview only.");
 await waitFor(()=>expect(screen.getByRole("button",{name:"Cancel"})).toHaveFocus());
 fireEvent.keyDown(dialog,{key:"Escape"});
 await waitFor(()=>expect(result).toHaveBeenCalledWith(false));
 await waitFor(()=>expect(trigger).toHaveFocus());
 fireEvent.click(screen.getByRole("button",{name:"Preview confirmation"}));
 fireEvent.click(screen.getByRole("button",{name:"Remove"}));
 await waitFor(()=>expect(result).toHaveBeenLastCalledWith(true));
});
