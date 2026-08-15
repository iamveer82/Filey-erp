import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTool, setToolConfirm } from "../aiTools";
import { isOwnerNumber } from "../waAgent";

/* The WhatsApp path routes sensitive-tool approval over chat instead of the
 * in-app modal, via a per-run `confirm` override on runTool. These pin that the
 * override — not the global handler — is what decides, in both directions. */

beforeEach(() => localStorage.clear());
afterEach(() => setToolConfirm(() => false));

describe("runTool confirm override", () => {
  it("denies a sensitive tool when the override says no, even if the global says yes", async () => {
    setToolConfirm(() => true);
    const r = await runTool("mark_invoice_paid", { invoice_number: "T-1" }, () => false);
    expect(r).toEqual({ error: "Cancelled — the user did not approve this action." });
  });

  it("lets a sensitive tool run when the override says yes, even if the global says no", async () => {
    setToolConfirm(() => false);
    const r = await runTool("mark_invoice_paid", { invoice_number: "T-1" }, () => true);
    // Not "Cancelled" — the gate let it through; the tool then reports its own
    // outcome (here "no invoice matching", which is fine).
    expect(r).not.toEqual({ error: "Cancelled — the user did not approve this action." });
  });
});

/* Who counts as the owner decides who can drive the whole agent over WhatsApp,
 * so the match is exact on the number part of the JID — never a substring. */
describe("isOwnerNumber", () => {
  const ME = "971501234567:12@s.whatsapp.net";

  it("matches the paired number, device suffix and all", () => {
    expect(isOwnerNumber(ME, null, "971501234567@s.whatsapp.net")).toBe(true);
    expect(isOwnerNumber(ME, null, "971501234567")).toBe(true);
  });

  it("matches the company WhatsApp number from the profile", () => {
    expect(isOwnerNumber(null, "+971 50 765 4321", "971507654321")).toBe(true);
  });

  it("rejects a number that is merely a substring of the owner's", () => {
    expect(isOwnerNumber(ME, null, "5012345")).toBe(false);
    expect(isOwnerNumber(ME, null, "97150123456")).toBe(false);
  });

  it("rejects strangers, and empty input", () => {
    expect(isOwnerNumber(ME, "971507654321", "971509999999")).toBe(false);
    expect(isOwnerNumber(ME, null, "")).toBe(false);
    expect(isOwnerNumber(null, null, "971501234567")).toBe(false);
  });
});

describe("runTool owner-only gate", () => {
  it("denies an owner-only tool to a non-owner, regardless of confirm", async () => {
    const r = await runTool("run_shell", { command: "echo hi" }, () => true, false);
    expect(r).toEqual({ error: `"run_shell" is owner-only — only the business owner can run it.` });
  });

  it("lets an owner past the gate (blocked only at the desktop boundary)", async () => {
    const r = await runTool("run_shell", { command: "echo hi" }, () => true, true);
    expect(r).not.toEqual({ error: `"run_shell" is owner-only — only the business owner can run it.` });
  });
});
