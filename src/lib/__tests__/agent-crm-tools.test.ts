import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { TOOLS } from "../aiTools";

// The pipeline tools decide what a salesperson is told to chase, so the pieces
// that matter are: a deal's stage carries its probability, closed deals stay
// out of the open list, and a logged call actually attaches to the deal it was
// about (target_type "deal" — the string the neglect detector reads).
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

describe("deals", () => {
  it("opens a deal with the probability its stage implies", async () => {
    await tool("create_deal").run({
      title: "Fit-out for Acme",
      customer_name: "Acme",
      value: 50_000,
      stage: "negotiation",
    });
    const r = (await tool("list_deals").run({})) as {
      count: number;
      open_value: number;
      deals: { probability: number; stage: string }[];
    };
    expect(r.count).toBe(1);
    expect(r.open_value).toBe(50_000);
    expect(r.deals[0].stage).toBe("negotiation");
    expect(r.deals[0].probability).toBe(70);
  });

  it("keeps closed deals out of the open list but counts them in win/loss", async () => {
    const made = (await tool("create_deal").run({
      title: "Won one",
      customer_name: "Globex",
      value: 1000,
    })) as { id: number };
    await tool("set_deal_stage").run({ deal_id: made.id, stage: "won" });

    const open = (await tool("list_deals").run({})) as { count: number };
    expect(open.count).toBe(0);

    const all = (await tool("list_deals").run({ include_closed: true })) as {
      count: number;
    };
    expect(all.count).toBe(1);

    const pipe = (await tool("crm_pipeline").run({})) as {
      win_loss: { won: number };
    };
    expect(pipe.win_loss.won).toBe(1);
  });

  it("refuses a stage that isn't a stage", async () => {
    const made = (await tool("create_deal").run({
      title: "X",
      customer_name: "Y",
    })) as { id: number };
    const r = (await tool("set_deal_stage").run({
      deal_id: made.id,
      stage: "nearly-there",
    })) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});

describe("activity", () => {
  it("attaches a logged call to the deal it was about", async () => {
    const made = (await tool("create_deal").run({
      title: "Renewal",
      customer_name: "Acme",
      value: 200,
    })) as { id: number };
    await tool("log_activity").run({
      kind: "call",
      subject: "Talked through the renewal",
      deal_id: made.id,
    });

    const forDeal = (await tool("list_activities").run({ deal_id: made.id })) as {
      count: number;
      activities: { kind: string }[];
    };
    expect(forDeal.count).toBe(1);
    expect(forDeal.activities[0].kind).toBe("call");
  });
});

describe("leads", () => {
  it("adds a lead and finds it by company", async () => {
    await tool("create_lead").run({
      name: "Sara",
      company: "Northwind Trading",
      est_value: 5000,
    });
    const r = (await tool("find_leads").run({ query: "northwind" })) as {
      leads: { name: string; est_value: number }[];
    };
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0].name).toBe("Sara");
    expect(r.leads[0].est_value).toBe(5000);
  });
});
