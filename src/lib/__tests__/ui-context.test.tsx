import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
