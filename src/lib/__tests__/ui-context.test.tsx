import { StrictMode, useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider, useUI } from "../ui";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("keeps notification callbacks stable so failed-load effects do not repeat",()=>{
 const load=vi.fn();
 function Page(){const {toast}=useUI();useEffect(()=>{load();},[toast]);return <button onClick={()=>toast.error("Fixture error")}>Notify</button>;}
 render(<UIProvider><Page/></UIProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Notify"}));
 expect(screen.getByText("Fixture error")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Dismiss"}));
 expect(load).toHaveBeenCalledOnce();
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
