import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { TOOLS } from "../aiTools";
import { crm } from "../api";

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

describe("closing a deal captures why", () => {
  it("stamps close_reason + closed_at on lost, clears them on reopen", async () => {
    const made = (await tool("create_deal").run({
      title: "Price war",
      customer_name: "Initech",
      value: 9000,
    })) as { id: number };

    await tool("set_deal_stage").run({
      deal_id: made.id,
      stage: "lost",
      reason: "Price too high",
    });
    const closed = (await tool("list_deals").run({
      include_closed: true,
      stage: "lost",
    })) as { deals: { id: number; close_reason: string | null; closed_at: string | null }[] };
    const row = closed.deals.find((d) => d.id === made.id)!;
    expect(row.close_reason).toBe("Price too high");
    expect(row.closed_at).toBeTruthy();

    // Reopening a lost deal must un-close it, or the win/loss report lies.
    await tool("set_deal_stage").run({ deal_id: made.id, stage: "proposal" });
    const reopened = (await tool("list_deals").run({
      include_closed: true,
    })) as { deals: { id: number; close_reason: string | null }[] };
    expect(reopened.deals.find((d) => d.id === made.id)!.close_reason).toBeNull();
  });

  it("leaves a stage_change trail the timeline can show", async () => {
    const made = (await tool("create_deal").run({
      title: "Trail check",
      customer_name: "Umbrella",
    })) as { id: number };
    await tool("set_deal_stage").run({ deal_id: made.id, stage: "proposal" });
    const acts = (await tool("list_activities").run({ deal_id: made.id })) as {
      activities: { kind: string; subject: string }[];
    };
    const move = acts.activities.find((a) => a.kind === "stage_change");
    expect(move).toBeTruthy();
    expect(move!.subject).toMatch(/→ proposal/);
  });

  it("refuses to move a deal that does not exist", async () => {
    const r = (await tool("set_deal_stage").run({
      deal_id: 999999,
      stage: "won",
    })) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});

describe("deal contact roles", () => {
  it("links a person with a role and reads it back", async () => {
    const cust = await crm.createCustomer({ name: "Role Co" });
    const person = await crm.createPerson({ name: "Sara", company_id: cust });
    const deal = (await tool("create_deal").run({
      title: "Sponsored",
      customer_name: "Role Co",
    })) as { id: number };

    await tool("set_deal_contact").run({
      deal_id: deal.id,
      person_id: person,
      role: "Decision maker",
    });
    const read = (await tool("get_deal_contacts").run({
      deal_id: deal.id,
    })) as { contacts: { person_id: number; role: string }[] };
    expect(read.contacts).toHaveLength(1);
    expect(read.contacts[0].person_id).toBe(person);
    expect(read.contacts[0].role).toBe("Decision maker");

    // Empty role removes the link — same verb for change/remove.
    await tool("set_deal_contact").run({
      deal_id: deal.id,
      person_id: person,
      role: "",
    });
    const gone = (await tool("get_deal_contacts").run({ deal_id: deal.id })) as {
      contacts: unknown[];
    };
    expect(gone.contacts).toHaveLength(0);
  });

  it("refuses roles on deals or people that do not exist", async () => {
    const set = (await tool("set_deal_contact").run({
      deal_id: 424242,
      person_id: 1,
      role: "Champion",
    })) as { error?: string };
    expect(set.error).toBeTruthy();

    const deal = (await tool("create_deal").run({
      title: "Ghost check",
      customer_name: "Nobody",
    })) as { id: number };
    const bad = (await tool("set_deal_contact").run({
      deal_id: deal.id,
      person_id: 987654,
      role: "Champion",
    })) as { error?: string };
    expect(bad.error).toBeTruthy();
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
