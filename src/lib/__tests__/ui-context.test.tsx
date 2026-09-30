import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider, useUI } from "../ui";
afterEach(cleanup);
it("keeps notification callbacks stable so failed-load effects do not repeat",()=>{
 const load=vi.fn();
 function Page(){const {toast}=useUI();useEffect(()=>{load();},[toast]);return <button onClick={()=>toast.error("Fixture error")}>Notify</button>;}
 render(<UIProvider><Page/></UIProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Notify"}));
 expect(screen.getByText("Fixture error")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Dismiss"}));
 expect(load).toHaveBeenCalledOnce();
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
