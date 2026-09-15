import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaymentsModal } from "../Invoicing";
import { billing, type InvoiceDocSummary } from "../../lib/api";
import { UIProvider } from "../../lib/ui";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("ignores payments from a previous invoice and blocks adding after a failed load",async()=>{
 let finish!: (rows:never[])=>void;
 const payments=vi.spyOn(billing,"payments").mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(new Error("Fixture offline"));
 const doc={id:1,number:"FIXTURE-1",currency:"AED",total:100} as InvoiceDocSummary;
 const view=render(<UIProvider><PaymentsModal doc={doc} onClose={()=>{}} onSaved={()=>{}}/></UIProvider>);
 await waitFor(()=>expect(payments).toHaveBeenCalledOnce());
 view.rerender(<UIProvider><PaymentsModal doc={{...doc,id:2,number:"FIXTURE-2"}} onClose={()=>{}} onSaved={()=>{}}/></UIProvider>);
 expect(await screen.findByText(/Could not load payments/)).toBeInTheDocument();
 await act(async()=>finish([]));
 fireEvent.change(screen.getByRole("spinbutton",{name:"Payment amount"}),{target:{value:"25"}});
 expect(screen.getByRole("button",{name:/^Add$/})).toBeDisabled();
 expect(screen.getByText(/Could not load payments/)).toBeInTheDocument();
});
