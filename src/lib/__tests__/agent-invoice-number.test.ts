import { expect, it } from "vitest";
import { createGuard, numberGiven } from "../agentGuard";

// The agent used to make up invoice numbers (63, 43) when the next one was 32. A number the
// user did not write is dropped, so Filey assigns the next one in the saved sequence.
it("keeps only invoice numbers the user wrote", () => {
  expect(numberGiven("INV-DLS-032-26", "make invoice INV-DLS-032-26 for Rennox")).toBe(true);
  expect(numberGiven("INV-DLS-032-26", "make invoice 32 for Rennox")).toBe(true);
  expect(numberGiven("INV-DLS-063-26", "make an invoice for Rennox, 48 pails")).toBe(false);
  expect(numberGiven("INV-DLS-063-26", "make an invoice for Rennox for 63 pails")).toBe(true);
});

it("drops a made-up number before the invoice tool runs", () => {
  const args: Record<string, unknown> = { customer_name: "Rennox", invoice_number: "INV-DLS-063-26", items: [] };
  createGuard("make an invoice for Rennox, 48 pails at 4.1").before("create_invoice_draft", args);
  expect(args).not.toHaveProperty("invoice_number");
  const given: Record<string, unknown> = { customer_name: "Rennox", invoice_number: "INV-DLS-040-26", items: [] };
  createGuard("make invoice INV-DLS-040-26 for Rennox").before("create_invoice_draft", given);
  expect(given.invoice_number).toBe("INV-DLS-040-26");
});
