// Delivery challans: the shared record shape, and the agent tools over it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadChallans,
  saveChallans,
  blankChallanForm,
  challanRecord,
  DC_STORAGE_KEY,
} from "../challans";
import { runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Write-through to app_settings is a cross-device nicety, not part of what
    // these cases are asserting.
    tools: { setSetting: () => Promise.resolve(), settings: () => Promise.resolve([]) },
  };
});

beforeEach(() => {
  localStorage.clear();
  setAgentMode("auto"); // gate behaviour has its own tests
});

describe("challan storage", () => {
  it("round-trips a record", () => {
    const form = blankChallanForm("DC-001");
    saveChallans([challanRecord({ ...form, party_name: "Acme" })]);
    const back = loadChallans();
    expect(back).toHaveLength(1);
    expect(back[0].number).toBe("DC-001");
    expect(back[0].party_name).toBe("Acme");
  });

  it("summary fields match the form they wrap", () => {
    // The list renders from the summary and the editor from `form`; if they
    // disagree the row says one thing and opening it shows another.
    const form = {
      ...blankChallanForm("DC-002"),
      party_name: "Nadia Trading",
      destination: "Jebel Ali",
      status: "in_transit" as const,
      items: [
        { description: "Pump", qty: 2 },
        { description: "Hose", qty: 5 },
      ],
    };
    const r = challanRecord(form);
    expect(r.party_name).toBe(form.party_name);
    expect(r.destination).toBe(form.destination);
    expect(r.status).toBe(form.status);
    expect(r.item_count).toBe(2);
  });

  it("survives a corrupt blob rather than throwing", () => {
    localStorage.setItem(DC_STORAGE_KEY, "{not json");
    expect(loadChallans()).toEqual([]);
  });
});

describe("create_delivery_challan", () => {
  it("creates a challan with items and returns its number", async () => {
    const out = (await runTool(
      "create_delivery_challan",
      {
        party_name: "Acme Trading",
        items: [{ description: "Steel pipe", qty: 10 }],
        destination: "Sharjah",
      },
      undefined,
      true
    )) as { ok?: boolean; number?: string; items?: number };

    expect(out.ok).toBe(true);
    expect(out.number).toBeTruthy();
    expect(out.items).toBe(1);

    const stored = loadChallans();
    expect(stored).toHaveLength(1);
    expect(stored[0].party_name).toBe("Acme Trading");
    expect(stored[0].form?.items[0].description).toBe("Steel pipe");
    expect(stored[0].form?.destination).toBe("Sharjah");
  });

  it("defaults a missing qty to 1 and drops blank lines", async () => {
    await runTool(
      "create_delivery_challan",
      {
        party_name: "Acme",
        items: [{ description: "Widget" }, { description: "" }, { qty: 3 }],
      },
      undefined,
      true
    );
    const items = loadChallans()[0].form?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ description: "Widget", qty: 1 });
  });

  it("refuses a challan with no party", async () => {
    const out = (await runTool(
      "create_delivery_challan",
      { party_name: "", items: [{ description: "x", qty: 1 }] },
      undefined,
      true
    )) as { error?: string };
    expect(out.error).toMatch(/party/i);
    expect(loadChallans()).toEqual([]);
  });

  it("refuses a challan with no usable items", async () => {
    const out = (await runTool(
      "create_delivery_challan",
      { party_name: "Acme", items: [{ description: "" }] },
      undefined,
      true
    )) as { error?: string };
    expect(out.error).toMatch(/item/i);
    expect(loadChallans()).toEqual([]);
  });

  it("falls back to a delivery challan when the type is not recognised", async () => {
    await runTool(
      "create_delivery_challan",
      { party_name: "Acme", items: [{ description: "x" }], dc_type: "nonsense" },
      undefined,
      true
    );
    expect(loadChallans()[0].dc_type).toBe("delivery");
  });

  it("gives each challan a distinct number", async () => {
    for (let i = 0; i < 3; i++)
      await runTool(
        "create_delivery_challan",
        { party_name: `P${i}`, items: [{ description: "x" }] },
        undefined,
        true
      );
    const numbers = loadChallans().map((r) => r.number);
    expect(new Set(numbers).size).toBe(3);
  });
});

describe("list_delivery_challans", () => {
  it("returns newest first and filters by status", async () => {
    await runTool(
      "create_delivery_challan",
      { party_name: "First", items: [{ description: "a" }] },
      undefined,
      true
    );
    await runTool(
      "create_delivery_challan",
      { party_name: "Second", items: [{ description: "b" }] },
      undefined,
      true
    );

    const all = (await runTool("list_delivery_challans", {}, undefined, true)) as {
      count: number;
      challans: { party: string; status: string }[];
    };
    expect(all.count).toBe(2);
    expect(all.challans[0].party).toBe("Second"); // newest first

    const inTransit = (await runTool(
      "list_delivery_challans",
      { status: "in_transit" },
      undefined,
      true
    )) as { count: number };
    expect(inTransit.count).toBe(0); // both are still "preparing"
  });
});
