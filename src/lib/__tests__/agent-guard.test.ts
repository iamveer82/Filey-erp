import { describe, expect, it } from "vitest";
import { createGuard, isReadOnly, coachResult, toolFailure } from "../agentGuard";

// The duplicate-write case is the one that reaches a customer: a model that
// second-guesses its first result and calls send_invoice again. Everything else
// here is about not burning rounds re-reading what it already knows.

describe("read or write", () => {
  it("classifies by name, erring towards write", () => {
    expect(isReadOnly("list_invoices")).toBe(true);
    expect(isReadOnly("find_customers")).toBe(true);
    expect(isReadOnly("vat_return")).toBe(true);
    expect(isReadOnly("receivables_aging")).toBe(true);
    expect(isReadOnly("send_invoice")).toBe(false);
    expect(isReadOnly("create_invoice_draft")).toBe(false);
    expect(isReadOnly("composio_run")).toBe(false);
    // Unknown tools are treated as writes — re-running a read costs a round,
    // re-running a write costs the customer.
    expect(isReadOnly("do_something_new")).toBe(false);
  });
});

describe("repeated calls", () => {
  it("refuses an identical write and explains what already happened", () => {
    const g = createGuard();
    expect(g.before("send_invoice", { invoice_number: "INV-1" })).toEqual({});
    g.after("send_invoice", { invoice_number: "INV-1" }, { ok: true, message: "Sent." });

    const second = g.before("send_invoice", { invoice_number: "INV-1" });
    const short = second.short as { error: string; previous_result: unknown };
    expect(short.error).toMatch(/not repeating/i);
    expect(short.previous_result).toEqual({ ok: true, message: "Sent." });
  });

  it("lets a genuinely different write through", () => {
    const g = createGuard();
    g.after("send_invoice", { invoice_number: "INV-1" }, { ok: true });
    expect(g.before("send_invoice", { invoice_number: "INV-2" })).toEqual({});
  });

  it("answers a repeated read from memory instead of re-running it", () => {
    const g = createGuard();
    g.after("list_invoices", { limit: 5 }, { count: 2 });
    const again = g.before("list_invoices", { limit: 5 });
    expect(again.short).toEqual({ count: 2 });
  });

  it("does not care what order the model wrote the arguments in", () => {
    const g = createGuard();
    g.after("send_invoice", { a: 1, b: 2 }, { ok: true });
    const again = g.before("send_invoice", { b: 2, a: 1 });
    expect(again.short).toBeTruthy();
  });
  it("protects nested writes regardless of property order without ignoring array order", () => {
    const g = createGuard();
    g.after("create_invoice_draft", { items: [{ description: "Service", qty: 1 }], customer: { id: 2, name: "Mark" } }, { id: 9 });
    expect(g.before("create_invoice_draft", { customer: { name: "Mark", id: 2 }, items: [{ qty: 1, description: "Service" }] }).short).toBeDefined();
    expect(g.before("create_invoice_draft", { customer: { name: "Mark", id: 2 }, items: [{ qty: 2, description: "Service" }] })).toEqual({});
  });
  it("selects a saved file again and invalidates the earlier document observation", () => {
    const g = createGuard();
    g.after("use_saved_file", { name: "A.pdf" }, { ok: true });
    g.after("read_attached_document", {}, { text: "Document A" });
    g.after("use_saved_file", { name: "B.pdf" }, { ok: true });
    expect(g.before("read_attached_document", {})).toEqual({});
    expect(g.before("use_saved_file", { name: "A.pdf" })).toEqual({});
  });
  it("reads current records after a mutation instead of reusing pre-edit results", () => {
    const g = createGuard();
    g.after("list_invoices", {}, { invoices: [] });
    g.after("create_invoice_draft", { customer: "Acme" }, { id: 1 });
    expect(g.before("list_invoices", {})).toEqual({});
    expect(g.before("create_invoice_draft", { customer: "Acme" }).short).toBeDefined();
  });
  it("always takes a fresh computer screenshot", () => {
    const g = createGuard();
    g.after("computer_use", { action: "screenshot", window_id: "1" }, { snapshot_id: "old" });
    expect(g.before("computer_use", { action: "screenshot", window_id: "1" })).toEqual({});
  });
});

describe("coaching a failure", () => {
  it("leaves a success untouched", () => {
    const ok = { ok: true, number: "INV-1" };
    expect(coachResult(ok, 5)).toBe(ok);
  });

  it("tells the model to adapt, and how much room it has left", () => {
    const r = coachResult({ error: "No such customer" }, 6) as {
      error: string;
      steps_remaining: number;
      what_to_do: string;
    };
    expect(r.error).toBe("No such customer");
    expect(r.steps_remaining).toBe(6);
    expect(r.what_to_do).toMatch(/DIFFERENT approach/);
    expect(r.what_to_do).not.toMatch(/last step/);
  });

  it("switches to wrapping up on the final step", () => {
    const r = coachResult({ error: "nope" }, 1) as { what_to_do: string };
    expect(r.what_to_do).toMatch(/last step/i);
  });
  it("does not coach the model to bypass a denied approval", () => {
    expect(coachResult({ error: "Cancelled — the user did not approve this action." }, 6)).toMatchObject({ what_to_do: expect.stringContaining("Do not retry through a different tool") });
  });
  it.each(["Your workspace role does not have access to invoicing.", "Only a workspace owner or administrator can use computer, shell or unrestricted network tools."])("respects the verified workspace boundary: %s", error => {
    expect(coachResult({ error }, 6)).toMatchObject({ what_to_do: expect.stringContaining("Do not retry through a different tool") });
  });
  it("contains a malformed cyclic provider error", () => {
    const error: Record<string, unknown> = {}; error.self = error;
    expect(toolFailure({ error })).toBe("The action returned an error.");
  });
});

describe("run summary", () => {
  it("resolves trusted schema rejections only for the same invoice and preserves actual failed writes", () => {
    const g = createGuard();
    const name = "update_invoice_appearance";
    g.after(name, { invoice_number: "INV-1", stamp_opacity: 101 }, { error: "Out of range", code: "invalid_arguments" }, true);
    g.after(name, { invoice_number: "INV-2", stamp_opacity: 100 }, { ok: true });
    expect(g.unresolvedFailures()).toMatchObject([{ args: { invoice_number: "INV-1" }, invalidArguments: true }]);
    g.after(name, { invoice_number: "INV-1", stamp_opacity: 100 }, { ok: true });
    expect(g.unresolvedFailures()).toEqual([]);
    // Provider flags cannot turn a dispatched write into a safe validation rejection.
    g.after(name, { invoice_number: "INV-3", stamp_opacity: 90 }, { error: "Outcome uncertain", code: "invalid_arguments", retry_safe: false });
    g.after(name, { invoice_number: "INV-3", stamp_opacity: 100 }, { ok: true });
    expect(g.unresolvedFailures()).toMatchObject([{ args: { invoice_number: "INV-3" } }]);
    expect(g.unresolvedFailures()[0].invalidArguments).toBeUndefined();
  });

  it("keeps failures on one record when another record succeeds", () => {
    const g = createGuard();
    g.after("email_invoice", { invoice_number: "INV-1" }, { error: "Delivery unconfirmed", retry_safe: false });
    g.after("email_invoice", { invoice_number: "INV-2" }, { ok: true });
    expect(g.unresolvedFailures()).toMatchObject([{ args: { invoice_number: "INV-1" } }]);
    expect(g.summary()).toContain("Delivery unconfirmed");
  });

  it("retries failed lookups and resolves only the same lookup after success", () => {
    const g = createGuard();
    g.after("get_invoice", { invoice_number: "INV-1" }, { error: "Temporary connection error" });
    expect(g.before("get_invoice", { invoice_number: "INV-1" })).toEqual({});
    g.after("get_invoice", { invoice_number: "INV-2" }, { id: 2 });
    expect(g.unresolvedFailures()).toHaveLength(1);
    g.after("get_invoice", { invoice_number: "INV-1" }, { id: 1 });
    expect(g.unresolvedFailures()).toEqual([]);
    expect(g.summary()).not.toContain("Failed:");
  });

  it("permits a fresh PDF after editing but still refuses repeated sends", () => {
    const g = createGuard();
    const args = { invoice_number: "INV-1" };
    g.after("export_invoice_pdf", args, { ok: true });
    g.after("update_invoice_appearance", { ...args, show_logo: false }, { ok: true });
    expect(g.before("export_invoice_pdf", args)).toEqual({});
    g.after("send_invoice_whatsapp", args, { ok: true });
    expect(g.before("send_invoice_whatsapp", args).short).toMatchObject({ retry_safe: false });
  });

  it("reports what was done and what failed", () => {
    const g = createGuard();
    g.after("create_invoice_draft", {}, { ok: true, message: "Draft created" });
    g.after("send_invoice", {}, { error: "No such invoice" });
    const s = g.summary();
    expect(s).toMatch(/Draft created/);
    expect(s).toMatch(/Failed:.*No such invoice/);
    expect(g.steps()).toHaveLength(2);
  });

  it("is empty before anything happens, so the caller can fall back", () => {
    expect(createGuard().summary()).toBe("");
  });
  it("reports provider failure flags and pending media truthfully", () => {
    const g = createGuard();
    g.after("composio_run", {}, { successful: false, message: "Not delivered" });
    g.after("generate_image", {}, { pending_action: "media_approval", job_id: "draft-1" });
    expect(g.steps()[0].ok).toBe(false);
    expect(g.summary()).toContain("Not delivered");
    expect(g.summary()).toContain("waiting for media approval");
    expect(coachResult({ ok: false }, 3)).toMatchObject({ error: expect.any(String) });
  });
});
