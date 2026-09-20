import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { messages, channels, emailLog, callLog } from "../api";

/* Chat channels, the email record and call logs.
 *
 * The channel filter is the part that would rot silently: it is applied before
 * the 200-row cap, because filtering after it lets a busy channel push a quiet
 * one off the end so it renders empty rather than wrong. */

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

describe("chat channels", () => {
  it("keeps each channel's messages apart", async () => {
    await messages.post("general one", null, "general");
    await messages.post("sales one", null, "sales");
    await messages.post("sales two", null, "sales");

    const general = await messages.list("general");
    const sales = await messages.list("sales");

    expect(general.map((m) => m.body)).toEqual(["general one"]);
    expect(sales).toHaveLength(2);
    // Omitting the channel is "everything", which the comms log relies on.
    expect(await messages.list()).toHaveLength(3);
  });

  it("defaults older messages to general rather than hiding them", async () => {
    // A post with no channel is what every row predating channels looks like.
    await messages.post("legacy", null);
    expect((await messages.list("general")).map((m) => m.body)).toContain("legacy");
  });

  it("normalises channel names so #Sales and #sales are one room", async () => {
    await channels.create("Sales Team");
    const list = await channels.list();
    expect(list.map((c) => c.name)).toContain("sales-team");

    // Creating it again must return the existing room, not a second one.
    await channels.create("sales team");
    expect((await channels.list()).filter((c) => c.name === "sales-team")).toHaveLength(1);
  });

  it("refuses a channel name that normalises to nothing", async () => {
    await expect(channels.create("###")).rejects.toThrow();
  });
  it("paginates conversations without dropping replies and rejects cross-channel replies", async () => {
    for(let n=0;n<35;n++) await messages.post(`Thread ${n}`,null,"general");
    const first=await messages.page("general");
    expect(first.rows).toHaveLength(30);
    expect(first.rows.every(m => typeof m.user_id === "string" && m.author === "You")).toBe(true);
    const second=await messages.page("general",first.next!);
    expect(second.rows).toHaveLength(5);
    const root=second.rows[0].id;
    await messages.post("Reply to an older thread",root,"general");
    const threads=[...(await messages.page("general")).rows,...(await messages.page("general",first.next!)).rows];
    expect(threads.some(m=>m.parent_id===root)).toBe(true);
    await expect(messages.post("Wrong channel",root,"sales")).rejects.toThrow("this channel");
    await expect(messages.post(" ")).rejects.toThrow("characters");
  });
});

describe("email record", () => {
  it("keeps correspondence per record", async () => {
    await emailLog.record({
      to_email: "a@example.test",
      subject: "Invoice INV-1",
      entity_type: "invoice",
      entity_id: 7,
    });
    await emailLog.record({
      to_email: "b@example.test",
      subject: "Unrelated",
      entity_type: "invoice",
      entity_id: 8,
    });

    const forSeven = await emailLog.forEntity("invoice", 7);
    expect(forSeven).toHaveLength(1);
    expect(forSeven[0].subject).toBe("Invoice INV-1");
  });

  it("records failures too — a silent bounce is what you go looking for", async () => {
    await emailLog.record({
      to_email: "bad@example.test",
      subject: "Statement",
      status: "failed",
      error: "mailbox full",
    });
    const all = await emailLog.list();
    const failed = all.find((e) => e.status === "failed");
    expect(failed?.error).toBe("mailbox full");
  });
});

describe("call log", () => {
  it("stores minutes as seconds so short calls aren't rounded away", async () => {
    await callLog.add({ contact_name: "Acme", duration_secs: 90 });
    const [c] = await callLog.list();
    expect(c.duration_secs).toBe(90);
    expect(c.direction).toBe("outgoing");
  });

  it("finds calls about one record", async () => {
    await callLog.add({ contact_name: "Acme", entity_type: "customer", entity_id: 3 });
    await callLog.add({ contact_name: "Other", entity_type: "customer", entity_id: 4 });
    expect(await callLog.forEntity("customer", 3)).toHaveLength(1);
  });
});
