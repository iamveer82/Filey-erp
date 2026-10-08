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
  it("verifies a letter after an ambiguous revision without replaying the write or erasing its receipt", () => {
    const g = createGuard();
    const lookup = { letter_id: "letter-1" };
    const revision = { ...lookup, expected_revision: 1, changes: { body: "Updated introduction" } };
    g.after("get_letter", lookup, { id: "letter-1", revision: 1, body: "Original introduction" });
    const uncertain = { error: "The save acknowledgement was lost. Verify the letter.", retry_safe: false };
    // The database accepted revision 2 before the connection dropped. The
    // next verification must read it, not reuse the prior revision snapshot.
    g.after("revise_letter_draft", revision, uncertain);
    expect(g.before("get_letter", lookup)).toEqual({});
    g.after("get_letter", lookup, { id: "letter-1", revision: 2, body: "Updated introduction" });
    expect(g.before("get_letter", lookup).short).toMatchObject({ revision: 2 });
    expect(g.before("revise_letter_draft", revision).short).toMatchObject({ previous_result: uncertain, retry_safe: false });
    expect(g.unresolvedFailures()).toMatchObject([{ name: "revise_letter_draft", args: revision }]);
    expect(g.summary()).toContain(uncertain.error);
  });
  it("refreshes observations after an unconfirmed invoice send and still refuses a duplicate delivery", () => {
    const g = createGuard();
    const args = { invoice_number: "INV-1" };
    g.after("get_invoice", args, { status: "draft" });
    g.after("list_invoices", {}, { invoices: [{ number: "INV-1", status: "draft" }] });
    const uncertain = { error: "Delivery unconfirmed", retry_safe: false };
    g.after("send_invoice", args, uncertain);
    expect(g.before("get_invoice", args)).toEqual({});
    expect(g.before("list_invoices", {})).toEqual({});
    g.after("get_invoice", args, { status: "sent" });
    expect(g.before("send_invoice", args).short).toMatchObject({ previous_result: uncertain, retry_safe: false });
    expect(g.unresolvedFailures()).toHaveLength(1);
  });
  it("retains reads after trusted preflight rejection but not provider-declared validation failures", () => {
    const g = createGuard();
    const lookup = { letter_id: "letter-1" };
    const snapshot = { id: "letter-1", revision: 1 };
    g.after("get_letter", lookup, snapshot);
    g.after("revise_letter_draft", { ...lookup, expected_revision: "wrong" }, { error: "Invalid revision", code: "invalid_arguments" }, true);
    expect(g.before("get_letter", lookup).short).toBe(snapshot);
    g.after("revise_letter_draft", { ...lookup, expected_revision: 1 }, { error: "Outcome uncertain", code: "invalid_arguments", retry_safe: true });
    expect(g.before("get_letter", lookup)).toEqual({});
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
  it.each([
    "QuotaExceededError: The quota has been exceeded.",
    "The quota has been exceeded.",
    "Failed to execute 'setItem' on 'Storage': Setting the value of 'pending' exceeded the quota.",
    "Browser storage is full. Reopen Filey before retrying.",
  ])("does not invent an invoice cap from browser storage failure: %s", error => {
    const result = coachResult({ error }, 6);
    expect(result).toMatchObject({ failure_kind: "storage_quota", what_to_do: expect.stringContaining("does not establish an invoice count or a plan limit") });
    expect(result).toMatchObject({ what_to_do: expect.stringContaining("Do not probe other writes") });
  });
  it("respects an explicit plan limit while leaving provider quota errors unclassified", () => {
    expect(coachResult({ error: "Basic plan limit reached (5 cloud invoices this month)." }, 6)).toMatchObject({ failure_kind: "plan_limit" });
    expect(coachResult({ error: "Provider quota exceeded" }, 6)).not.toHaveProperty("failure_kind");
  });
  it("contains a malformed cyclic provider error", () => {
    const error: Record<string, unknown> = {}; error.self = error;
    expect(toolFailure({ error })).toBe("The action returned an error.");
  });
});

describe("invoice recovery scope", () => {
  const invoice = { customer_name: "Mark", items: [{ description: "6RC drums", qty: 6, unit_price: 0.2 }] };
  const creators = ["create_quote", "create_order", "create_purchase_order", "create_purchase_invoice_draft"];
  it.each(creators)("blocks %s after an invoice failure without a request for that document", name => {
    const g = createGuard("Create an invoice for Mark.");
    g.after("create_invoice_draft", invoice, { error: "The quota has been exceeded." });
    expect(g.before(name, {})).toMatchObject({ short: { code: "unrequested_document_fallback", retry_safe: false } });
    expect(g.before("get_invoice", { invoice_number: "INV-1" })).toEqual({});
    expect(g.before("create_customer", { name: "Separately requested customer" })).toEqual({});
    expect(g.before("create_invoice_draft", { ...invoice, items: [{ description: "6RC drums", qty: 6, unit_price: 0.2, custom: { total_liters: "1200" } }] })).toEqual({});
  });
  it.each(creators)("preserves separately requested multi-document work: %s", name => {
    const g = createGuard("Create an invoice and a quotation, a sales order, a purchase order and a supplier bill.");
    g.after("create_invoice_draft", invoice, { error: "Invoice save failed" });
    expect(g.before(name, {})).toEqual({});
  });
  it.each(["Create an invoice from quotation QT-1.", "Create an invoice from the quote for Mark.", "Do not create a quotation. Create an invoice for Mark.", "Don't create an invoice and a quote."])("does not treat a referenced or refused quotation as authorization: %s", request => {
    const g = createGuard(request);
    g.after("create_invoice_draft", invoice, { error: "Invoice save failed" });
    expect(g.before("create_quote", {})).toMatchObject({ short: { code: "unrequested_document_fallback" } });
  });
});

describe("run summary", () => {
  it.each(["Is the invoice done?", "Do not retry it.", "Continue the report but don't retry the invoice."])("does not replay a pending invoice without explicit retry intent: %s", request => {
    expect(createGuard(request).before("retry_invoice_save", { request_id: "request-1" }).short).toBeDefined();
  });

  it.each(["Retry the invoice save", "Continue the earlier save", "Please try again"])("allows an exact saved-request recovery when asked: %s", request => {
    const g = createGuard(request);
    g.after("list_pending_invoice_saves", {}, [{ request_id: "request-1", number: "INV-047" }]);
    expect(g.before("retry_invoice_save", { request_id: "request-1" })).toEqual({});
  });

  it("requires a request identity from pending discovery or the actual failed save, never a guessed or unrelated result ID", () => {
    const g = createGuard("Retry the invoice save");
    expect(g.before("retry_invoice_save", { request_id: "guessed" }).short).toMatchObject({ error: expect.stringContaining("list_pending_invoice_saves") });
    g.after("find_customers", {}, [{ request_id: "guessed" }]);
    expect(g.before("retry_invoice_save", { request_id: "guessed" }).short).toBeDefined();
    g.after("list_pending_invoice_saves", {}, [{ request_id: "actual-request", number: "INV-047" }]);
    expect(g.before("retry_invoice_save", { request_id: "guessed" }).short).toBeDefined();
    expect(g.before("retry_invoice_save", { request_id: "actual-request" })).toEqual({});
    g.after("create_invoice_draft", { customer_name: "Acme" }, { error: "Timeout", save_outcome: "unconfirmed", save_request_id: "current-request" });
    expect(g.before("retry_invoice_save", { request_id: "current-request" })).toEqual({});
  });

  it.each(["create_invoice_draft", "revise_invoice", "create_purchase_invoice_draft"])("blocks altered %s retries after an unconfirmed save while leaving verification available", name => {
    const g = createGuard("Create the requested invoice.");
    const original = { customer_name: "Acme", items: [{ qty: 6, unit_price: 0.2, custom: { liters: "1200" } }] };
    g.after(name, original, { error: "Statement timeout", save_outcome: "unconfirmed", retry_safe: false });
    expect(g.before(name, { ...original, items: [{ qty: 6, unit_price: 200 }] }).short).toMatchObject({ save_outcome: "unconfirmed", retry_safe: false });
    expect(g.before("create_invoice_draft", { ...original, invoice_number: "NEW-NUMBER" }).short).toMatchObject({ save_outcome: "unconfirmed" });
    expect(g.before("get_invoice", { invoice_number: "INV-1" })).toEqual({});
    g.after("get_invoice", { invoice_number: "INV-1" }, { error: "Read timed out" });
    expect(g.unresolvedFailures()).toContainEqual(expect.objectContaining({ name, unconfirmedSave: true }));
    expect(g.before(name, original).short).toMatchObject({ save_outcome: "unconfirmed" });
  });

  it("allows trusted preflight invoice corrections without claiming an uncertain save", () => {
    const g = createGuard();
    g.after("create_invoice_draft", { customer_name: "Acme", items: [] }, { error: "Items required", retry_safe: false }, true);
    expect(g.before("create_invoice_draft", { customer_name: "Acme", items: [{ qty: 6, unit_price: 0.2 }] })).toEqual({});
    expect(g.steps()[0]).not.toHaveProperty("unconfirmedSave");
  });

  it("requires API payload verification and the exact invoice identity to reconcile a save", () => {
    const g = createGuard();
    const args = { invoice_number: "INV-1", notes: "New text" };
    g.after("revise_invoice", args, { error: "Timeout", save_outcome: "unconfirmed", save_request_id: "request-1", invoice_number: "INV-1", invoice_id: 1 });
    for (const result of [
      { id: 1, number: "INV-1" },
      { id: 1, number: "INV-1", verified_save_requests: [] },
      { id: 1, number: "INV-1", verified_save_requests: ["other-request"] },
      { id: 2, number: "INV-1", verified_save_requests: ["request-1"] },
      { id: 1, number: "INV-2", verified_save_requests: ["request-1"] },
    ]) {
      g.after("get_invoice", { invoice_number: "INV-1" }, result);
      expect(g.unresolvedFailures()).toHaveLength(1);
    }
    g.after("get_invoice", { invoice_number: "INV-1" }, { id: 1, number: "INV-1", verified_save_requests: ["request-1"] });
    expect(g.unresolvedFailures()).toEqual([]);
    expect(g.before("create_invoice_draft", { customer_name: "Other customer" })).toEqual({});
    expect(g.before("revise_invoice", args).short).toMatchObject({ previous_result: { ok: true, id: 1, number: "INV-1" }, retry_safe: false });
  });

  it.each(["letter_id", "letter_number"])("resolves only trusted letter schema failures for the same %s", target => {
    const g = createGuard();
    const name = "revise_letter_draft";
    g.after(name, { [target]: "first", expected_revision: "wrong" }, { error: "Invalid revision" }, true);
    g.after(name, { [target]: "second", expected_revision: 1 }, { ok: true });
    expect(g.unresolvedFailures()).toMatchObject([{ args: { [target]: "first" }, invalidArguments: true }]);
    g.after(name, { [target]: "first", expected_revision: 1 }, { ok: true });
    expect(g.unresolvedFailures()).toEqual([]);
    g.after(name, { [target]: "third", expected_revision: 1 }, { error: "Unknown save outcome", code: "invalid_arguments" });
    g.after(name, { [target]: "third", expected_revision: 2 }, { ok: true });
    expect(g.unresolvedFailures()).toMatchObject([{ args: { [target]: "third" } }]);
    expect(g.unresolvedFailures()[0].invalidArguments).toBeUndefined();
  });
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
