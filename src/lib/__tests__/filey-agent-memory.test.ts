import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("../agentStorage", () => ({
  readAgentStorage: (key: string) => store.get(key) ?? null,
  writeAgentStorage: (key: string, value: string | null) => { if (value === null) store.delete(key); else store.set(key, value); },
}));
vi.mock("../computerUse", () => ({ taskComputerSession: () => ({ get: vi.fn(async () => 1), stop: vi.fn(async () => {}) }) }));
vi.mock("../aiTools", () => ({ TOOLS: [], runTool: vi.fn() }));

import { FileyAgentClient, carryRecap, fileyAgentTurnOn, forgetFileyAgentSession, rememberFileyAgentTurn, type AgentTransport } from "../fileyAgent";

const TOO_LARGE = "custom rejected this request as malformed, so the model didn't answer.\n\nProvider said: HTTP 400: {\"error\":\"This conversation is too large for the selected model. Start a new chat or choose a larger-context model.\"}";

/** A scripted engine: each session.create gets a new id; `answer` decides each prompt's reply. */
function engine(answer: (session: string, text: string) => { text: string; status: string }) {
  let deliver: (line: string) => void = () => {};
  const prompts: { session: string; text: string }[] = [];
  let sessions = 0;
  const transport: AgentTransport = {
    send: (line) => {
      const f = JSON.parse(line) as { id: string; method: string; params: Record<string, string> };
      const reply = (result: unknown) => queueMicrotask(() => deliver(JSON.stringify({ jsonrpc: "2.0", id: f.id, result })));
      if (f.method === "session.create") reply({ session_id: `new-${++sessions}`, stored_session_id: `stored-new-${sessions}` });
      else if (f.method === "session.resume") reply({ session_id: f.params.session_id.replace("stored-", "") });
      else if (f.method === "prompt.submit") {
        prompts.push({ session: f.params.session_id, text: f.params.text });
        reply({ status: "streaming" });
        const out = answer(f.params.session_id, f.params.text);
        queueMicrotask(() => deliver(JSON.stringify({ jsonrpc: "2.0", method: "event",
          params: { type: "message.complete", session_id: f.params.session_id, payload: out } })));
      } else reply({});
    },
    onLine: (cb) => { deliver = cb; return () => { deliver = () => {}; }; },
  };
  return { client: new FileyAgentClient(transport), prompts };
}

async function turn(client: FileyAgentClient, chatId: string, text: string, userText = text) {
  const events = [];
  const stream = fileyAgentTurnOn(client, chatId, text, { confirm: () => true, isOwner: true }, [], userText);
  for (;;) {
    const step = await stream.next();
    if (step.done) return { answer: step.value, events };
    events.push(step.value);
  }
}

beforeEach(() => store.clear());

it("keeps a recap of each chat for its next fresh session, and lends an app chat's recap to a new app chat only", () => {
  rememberFileyAgentTurn("chat-a", "Draft a NOC letter for Ravi", "Done: NOC letter created.", 1);
  rememberFileyAgentTurn("whatsapp:9715", "Invoice Acme 500", "Invoice INV-7 created.", 2);
  expect(carryRecap("chat-a")).toContain("Owner: Draft a NOC letter for Ravi");
  expect(carryRecap("chat-b")).toContain("[From the owner's previous chat");
  expect(carryRecap("chat-b")).toContain("NOC letter");
  // A channel chat never borrows another chat's memory.
  expect(carryRecap("whatsapp:other")).toBe("");
  expect(carryRecap("whatsapp:9715")).toContain("Invoice Acme 500");
  // Automation runs are not remembered.
  rememberFileyAgentTurn("automation:daily", "x", "y");
  expect(carryRecap("automation:daily")).toBe("");
});

it("starts a fresh session with a recap when the model refuses the chat as too large, instead of failing every turn", async () => {
  const { client, prompts } = engine((session) => session === "s1"
    ? { text: TOO_LARGE, status: "error" }
    : { text: "Here is your letter again.", status: "complete" });
  rememberFileyAgentTurn("whatsapp:9715", "Make my letterhead letter", "Letter created.");
  // The chat already has an engine session (s1) that grew too large.
  store.set("filey.agent.hermesSessions", JSON.stringify({ "whatsapp:9715": "stored-s1" }));
  const { answer, events } = await turn(client, "whatsapp:9715", "Send me here");
  expect(answer).toBe("Here is your letter again.");
  expect(events.filter((e) => e.type === "done")).toEqual([{ type: "done", text: "Here is your letter again.", reason: "answered" }]);
  expect(prompts.map((p) => p.session)).toEqual(["s1", "new-1"]);
  expect(prompts[0].text).toBe("Send me here");
  expect(prompts[1].text).toContain("[Earlier in this chat");
  expect(prompts[1].text).toContain("Make my letterhead letter");
  expect(prompts[1].text.endsWith("Send me here")).toBe(true);
  // This exchange is remembered for the next fresh start.
  expect(carryRecap("whatsapp:9715")).toContain("Send me here");
});

it("recovers from the engine's own 'grown too long' reply too, and sends the channel brief once per session", async () => {
  const GROWN = "This conversation has grown too long for filey-ai to read, and Filey couldn't shrink it enough automatically. Start a new session with /new (your history is kept), or try /compress once more.";
  const { client, prompts } = engine((session) => session === "s1" ? { text: GROWN, status: "error" } : { text: "Done.", status: "complete" });
  store.set("filey.agent.hermesSessions", JSON.stringify({ "whatsapp:9716": "stored-s1" }));
  const brief = "[Filey WhatsApp chat rules]";
  const run = async (text: string) => {
    const stream = fileyAgentTurnOn(client, "whatsapp:9716", text, { confirm: () => true, isOwner: true }, [], text, brief);
    for (;;) { const step = await stream.next(); if (step.done) return step.value; }
  };
  expect(await run("Move the cursor in a circle")).toBe("Done.");
  expect(await run("Again")).toBe("Done.");
  expect(prompts.map((p) => p.session)).toEqual(["s1", "new-1", "new-1"]);
  // A resumed session already has the brief; the fresh one opens with it; later turns do not repeat it.
  expect(prompts.map((p) => p.text.startsWith(brief))).toEqual([false, true, false]);
});

it("gives a chat its recap after /new", async () => {
  const { client, prompts } = engine(() => ({ text: "Sure.", status: "complete" }));
  await turn(client, "telegram:42", "Remember my GSTIN is 27AAPFU0939F1ZV");
  forgetFileyAgentSession("telegram:42");
  await turn(client, "telegram:42", "What is my GSTIN?");
  expect(prompts[1].text).toContain("Remember my GSTIN is 27AAPFU0939F1ZV");
  expect(prompts[1].session).not.toBe(prompts[0].session);
});
