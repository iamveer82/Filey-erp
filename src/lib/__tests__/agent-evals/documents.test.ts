import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAgentStream, setAiConfig } from "../../ai";
import type { AgentEvent } from "../../agentHarness";
import { setDataMode } from "../../dataMode";
import { setAgentMode } from "../../agentMode";
import { billing, quotes } from "../../api";
import { TOOLS } from "../../aiTools";
import { invoiceLineAmount, r2 } from "../../money";
import { calls, says, scriptModel } from "./scriptedModel";

/* End-to-end agent runs against the real tools and the local database, with a
 * scripted model standing in for the LLM. Each case is "the model did this →
 * the business ended up like that".
 *
 * The first two are the bug that started all of this: an owner asked for
 * "68 Pail 20L, qty 20, 4.1 per litre, 400 litres total, price by litres" and
 * got a line of AED 82. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setAgentMode("auto"); // gates get their own cases below
  setAiConfig({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "k",
  });
});
afterEach(() => vi.unstubAllGlobals());

async function run(prompt: string, opts = {}) {
  const events: AgentEvent[] = [];
  const stream = aiAgentStream([{ role: "user", text: prompt }], {
    isOwner: true,
    ...opts,
  });
  for (;;) {
    const step = await stream.next();
    if (step.done) return { events, final: step.value };
    events.push(step.value);
  }
}

const RENNOX = {
  customer_name: "Rennox",
  custom_columns: [{ key: "total_liters", label: "T.Liters" }],
  price_by: "total_liters",
  items: [
    {
      description: "H/O 68 Pail 20L",
      qty: 20,
      unit: "Pail",
      unit_price: 4.1,
      custom: { total_liters: "400" },
    },
  ],
};

describe("pricing a line by the measure it is sold in", () => {
  it("puts 1,640 on the invoice, not 82", async () => {
    scriptModel([
      calls("create_invoice_draft", RENNOX, "Drafting that now."),
      says("Done — AED 1,640."),
    ]);

    await run("invoice Rennox: 68 Pail 20L, qty 20, 4.1 per litre, 400 litres");

    const docs = await billing.listDocs("sales");
    expect(docs).toHaveLength(1);
    const doc = await billing.getDoc(Number(docs[0].id));
    expect(doc.unit_price_formula).toEqual({ a: "total_liters", b: "unit_price" });
    expect(doc.custom_columns).toEqual([{ key: "total_liters", label: "T.Liters" }]);
    expect(doc.items[0].custom?.total_liters).toBe("400");
    expect(doc.items[0].unit).toBe("Pail");
    // 400 × 4.1, the whole point. Asserted on the line rather than the document
    // total, which carries the company's VAT on top.
    expect(invoiceLineAmount(doc.items[0], doc.unit_price_formula)).toBe(1640);
    expect(docs[0].total).toBe(r2(1640 * (1 + (doc.tax_rate || 0) / 100)));
  });

  it("tells the agent what the line actually came to", async () => {
    scriptModel([calls("create_invoice_draft", RENNOX), says("ok")]);
    const { events } = await run("invoice Rennox");
    const result = events.find((e) => e.type === "tool_result");
    // Without this the agent re-derives the figure in prose and gets it wrong.
    expect(result).toMatchObject({
      result: expect.objectContaining({ subtotal: 1640, priced_by: "total_liters" }),
    });
  });

  it("still prices an ordinary line by quantity", async () => {
    scriptModel([
      calls("create_invoice_draft", {
        customer_name: "Acme",
        items: [{ description: "Consulting", qty: 3, unit_price: 100 }],
      }),
      says("ok"),
    ]);
    await run("invoice Acme for 3 days consulting at 100");
    const docs = await billing.listDocs("sales");
    const doc = await billing.getDoc(Number(docs[0].id));
    expect(invoiceLineAmount(doc.items[0], doc.unit_price_formula)).toBe(300);
  });

  it("does the same for a quotation", async () => {
    scriptModel([
      calls("create_quote", {
        customer_name: "Rennox",
        custom_columns: [{ key: "total_liters", label: "T.Liters" }],
        price_by: "total_liters",
        items: [
          {
            description: "H/O 68 Pail 20L",
            qty: 20,
            unit: "Pail",
            rate: 4.1,
            custom: { total_liters: "400" },
          },
        ],
      }),
      says("ok"),
    ]);
    await run("quote Rennox the same");
    const list = await quotes.listDocs();
    const q = await quotes.getDoc(Number(list[0].id));
    expect(q.unit_price_formula).toEqual({ a: "total_liters", b: "unit_price" });
    expect(q.items[0].custom?.total_liters).toBe("400");
  });

  it("ignores a price_by naming a column no line carries", async () => {
    // Left in, the formula multiplies by a missing value and every amount
    // becomes zero — a silently empty invoice is worse than a wrong one.
    scriptModel([
      calls("create_invoice_draft", {
        customer_name: "Acme",
        price_by: "nonexistent",
        items: [{ description: "Widget", qty: 2, unit_price: 50 }],
      }),
      says("ok"),
    ]);
    await run("invoice Acme");
    const docs = await billing.listDocs("sales");
    const doc = await billing.getDoc(Number(docs[0].id));
    expect(doc.unit_price_formula ?? null).toBeNull();
    expect(invoiceLineAmount(doc.items[0], doc.unit_price_formula)).toBe(100);
  });
});

describe("the tools carry what the model needs to get this right", () => {
  // A schema-level guard: the run above only works because these exist. If a
  // future edit drops them, this says so in one line instead of a failing run.
  const params = (name: string) =>
    JSON.stringify(TOOLS.find((t) => t.name === name)?.parameters ?? {});
  const describes = (name: string) =>
    TOOLS.find((t) => t.name === name)?.description ?? "";

  for (const name of ["create_invoice_draft", "create_quote"]) {
    it(`${name} accepts a measure to price by`, () => {
      expect(params(name)).toContain("custom_columns");
      expect(params(name)).toContain("price_by");
      expect(params(name)).toContain("custom");
      // The model has to recognise the trigger, so the description must teach
      // it — the parameters alone never did.
      expect(describes(name).toLowerCase()).toContain("per litre");
    });
  }
});

describe("agent modes decide what a run may do", () => {
  // send_invoice lives in the "sales" domain, so a run has to open it first —
  // which is itself the Phase 1 behaviour, exercised here for real.
  const send = () =>
    scriptModel([
      calls("use_toolset", { name: "sales" }),
      calls("send_invoice", { invoice_number: "X-1" }),
      says("ok"),
    ]);

  it("Plan mode does not even offer a tool that changes data", async () => {
    setAgentMode("plan");
    const model = send();
    await run("send invoice X-1");
    // Not on the first request, and not after opening the domain either.
    expect(model.requests.flatMap((r) => r.offered)).not.toContain("send_invoice");
    expect(model.firstOffered()).toContain("get_stats");
  });

  it("Manual mode offers it but refuses without approval", async () => {
    setAgentMode("manual");
    const model = send();
    const { events } = await run("send invoice X-1", { confirm: async () => false });
    expect(model.requests[1].offered).toContain("send_invoice");
    const result = events.filter((e) => e.type === "tool_result").pop();
    expect(JSON.stringify(result)).toMatch(/did not approve/i);
  });

  it("Auto mode runs it without asking", async () => {
    setAgentMode("auto");
    send();
    let asked = false;
    const { events } = await run("send invoice X-1", {
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false); // Auto mode never reaches the confirm gate
    // No invoice X-1 exists, so the tool's own "not found" is the right answer
    // here — what matters is that nothing stopped it before it ran.
    const result = events.find((e) => e.type === "tool_result");
    expect(JSON.stringify(result)).not.toMatch(/did not approve/i);
  });
});

describe("the run protects itself", () => {
  it("refuses to make the same draft twice in one run", async () => {
    const twice = {
      customer_name: "Acme",
      items: [{ description: "Widget", qty: 1, unit_price: 10 }],
    };
    scriptModel([
      calls("create_invoice_draft", twice),
      calls("create_invoice_draft", twice),
      says("done"),
    ]);
    await run("invoice Acme");
    const docs = await billing.listDocs("sales");
    expect(docs).toHaveLength(1); // not two identical invoices
  });

  it("says what it managed when it runs out of steps", async () => {
    scriptModel([
      calls("create_invoice_draft", {
        customer_name: "Acme",
        items: [{ description: "Widget", qty: 1, unit_price: 10 }],
      }),
    ]);
    const { final } = await run("keep going", { maxRounds: 2 });
    expect(final).toMatch(/ran out of steps|couldn't finish/i);
  });
});

describe("the tool surface stays small", () => {
  it("offers a working set, not the whole catalogue", async () => {
    scriptModel([says("hello")]);
    const model = scriptModel([says("hello")]);
    await run("hello");
    expect(model.firstOffered().length).toBeLessThan(TOOLS.length / 2);
    expect(model.firstToolBytes()).toBeLessThan(15_000);
    // Everyday work needs no unlocking.
    expect(model.firstOffered()).toContain("create_invoice_draft");
    // Specialist work does.
    expect(model.firstOffered()).not.toContain("run_payroll");
    expect(model.firstOffered()).toContain("use_toolset");
  });

  it("brings a domain in when the model asks for it", async () => {
    const model = scriptModel([
      calls("use_toolset", { name: "people" }),
      calls("get_attendance_today", {}),
      says("all present"),
    ]);
    await run("who is in today?");
    expect(model.requests[0].offered).not.toContain("get_attendance_today");
    expect(model.requests[1].offered).toContain("get_attendance_today");
  });
});
