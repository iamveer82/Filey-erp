import { describe, expect, it } from "vitest";
import { createGuard, isReadOnly } from "../agentGuard";

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
});

describe("run summary", () => {
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
});
