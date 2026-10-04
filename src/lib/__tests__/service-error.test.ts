import { expect, it } from "vitest";
import { serviceError } from "../serviceError";

const walletDenials = [
  [
    "This request was already submitted. Refresh your balance before retrying.",
    "This request was already submitted. Refresh your Coin balance before trying again.",
  ],
  [
    "AI credits are paused while a payment dispute is reviewed.",
    "Coin spending is paused while a payment dispute is reviewed.",
  ],
  [
    "AI request limit reached. Wait a minute.",
    "AI request limit reached. Wait a minute before trying again.",
  ],
  [
    "Not enough available AI credits for this request. Add credits or lower the output limit.",
    "Insufficient credit. Add Coin to continue.",
  ],
  [
    "Daily AI spending limit reached. Adjust it in AI Credits.",
    "Coin spending is temporarily unavailable. Refresh your wallet and try again.",
  ],
  [
    "Task spending limit reached. Adjust it in AI Credits or reduce the task.",
    "Coin spending is temporarily unavailable. Refresh your wallet and try again.",
  ],
];

it("preserves the exact insufficient-Coin message from the managed AI service", async () => {
  const message = "Insufficient credit. Add Coin to continue.";
  expect((await serviceError({
    context: { status: 402, json: async () => ({ error: message }) },
  }, "Wallet unavailable.")).message).toBe(message);
});

it.each(walletDenials)("gives actionable Coin guidance for the known wallet denial %s", async (detail, message) => {
  const error = await serviceError({
    message: "Edge Function returned a non-2xx status code",
    context: { status: 402, json: async () => ({ error: detail }) },
  }, "Wallet unavailable.");
  expect(error.message).toBe(message);
});

it("also translates a known wallet denial returned without an HTTP context", async () => {
  const [detail, message] = walletDenials[3];
  expect((await serviceError(new Error(detail), "Wallet unavailable.")).message).toBe(message);
});

it.each([
  "Coin payments are not available yet.",
  "This AI credit pack is not configured correctly.",
  "This Coin promotion is not available for this account or amount.",
  "This Coin promotion has already been opened. Complete your original checkout.",
])("preserves the exact first-party checkout instruction %s", async (message) => {
  expect((await serviceError({
    message: "Edge Function returned a non-2xx status code",
    context: { status: 400, json: async () => ({ error: message }) },
  }, "Checkout unavailable.")).message).toBe(message);
  expect((await serviceError(new Error(message), "Checkout unavailable.")).message).toBe(message);
  expect((await serviceError({
    context: { status: 400, json: async () => ({ error: `${message} SQL SELECT private_rows` }) },
  }, "Checkout unavailable.")).message).toBe("Checkout unavailable.");
});

it.each([
  "Not enough available AI credits for this request. Add credits or lower the output limit. SQL SELECT private_rows",
  "Insufficient credit. Add Coin to continue. SQL SELECT private_rows",
  "Database exception: Authorization Bearer secret-fixture",
  "__proto__",
  "This account already owns Ultra. SQL SELECT private_rows",
  "Only the workspace owner or an admin can manage billing. Bearer secret-fixture",
  "Verify your email before adding AI credits. private-provider-response",
])("keeps unknown wallet details private: %s", async (detail) => {
  const error = await serviceError({
    context: { status: 402, json: async () => ({ error: detail }) },
  }, "Wallet unavailable.");
  expect(error.message).toBe("Wallet unavailable.");
});

it("keeps the workspace-mismatch instruction actionable without forwarding arbitrary suffixes", async () => {
  const message = "Workspace changed. Reopen Billing before continuing.";
  expect((await serviceError({ context: { status: 409, json: async () => ({ error: message }) } }, "Unavailable.")).message).toBe(message);
  expect((await serviceError(new Error("Your workspace changed. Bearer private-token"), "Unavailable.")).message)
    .toBe("Your account or workspace changed. Reopen this section before trying again.");
});

it("preserves sign-in and request-rate guidance for unrecognized service errors", async () => {
  expect((await serviceError({ context: { status: 401 } }, "Unavailable.")).message)
    .toBe("Please sign in to your Filey account again, then try this action.");
  expect((await serviceError({ context: { status: 429 } }, "Unavailable.")).message)
    .toBe("Too many attempts. Please wait a few minutes and try again.");
});
