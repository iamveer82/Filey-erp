import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aiReply } from "./agent.ts";
import { loadMemories, recentHistory } from "./context.ts";
import { recallMemories, rememberMemory } from "./tools-writes.ts";
import { channelActorAllowed } from "./access.ts";

type Row = Record<string, unknown>;
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
function database() {
  const state = {
    org: "personal-org", role: "owner", lostInsert: false, draftError: "",
    confirmed: true, walletError: "", walletCalls: [] as Row[], reserved: new Set<string>(),
    inserts: [] as [string, Row][], rpcCalls: 0, afterWrite: () => {},
    rows: {} as Record<string, Row[]>, filters: [] as [string, string, unknown][],
  };
  const client = {
    auth: { admin: { getUserById: (id: string) => Promise.resolve({ data: { user: { id, email_confirmed_at: state.confirmed ? "2026-01-01T00:00:00Z" : null } }, error: null }) } },
    from(table: string) {
      const filters: [string, unknown][] = [];
      let inserted = false;
      const result = () => {
        if (inserted) return { data: { id: 42 }, error: null };
        if (table === "profiles") return { data: { org_id: state.org }, error: null };
        if (table === "org_members") return { data: { role: state.role }, error: null };
        const rows = (state.rows[table] ?? []).filter(row => filters.every(([key, value]) =>
          (key === "raw->>org_id" ? (row.raw as Row | undefined)?.org_id : row[key]) === value));
        if (table === "agent_channels") return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      };
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters.push([key, value]); state.filters.push([table, key, value]); return builder; },
        order: () => builder, limit: () => builder, in: () => builder,
        insert: (row: Row) => { inserted = true; state.inserts.push([table, row]); state.afterWrite(); return builder; },
        update: (row: Row) => { state.inserts.push([table, row]); return builder; },
        maybeSingle: () => Promise.resolve(result()),
        single: () => state.lostInsert ? Promise.reject(new Error("response lost after commit")) : Promise.resolve(result()),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
    rpc: (name: string, args: Row) => {
      if (name === "filey_ai_wallet") {
        state.walletCalls.push(args);
        if (args.p_action === "reserve") {
          const id = String((args.p_args as Row).request_id);
          if (state.walletError || state.reserved.has(id)) return Promise.resolve({ data: null, error: { message: state.walletError || "This request was already submitted." } });
          state.reserved.add(id);
        }
        return Promise.resolve({ data: { balance_micros: 1_000_000, reserved_micros: 0 }, error: null });
      }
      state.rpcCalls++;
      if (state.draftError) return Promise.resolve({ data: null, error: { code: "22023", message: state.draftError } });
      state.afterWrite();
      return Promise.resolve({ data: { created: "draft", id: 42, number: "DEMO-42" }, error: null });
    },
  };
  return { client, state };
}

async function providerTest(run: (requests: Row[]) => Promise<void>, respond: (request: Row, round: number) => unknown) {
  const previousFetch = globalThis.fetch;
  const previousGet = Deno.env.get;
  const requests: Row[] = [];
  // Replace the getter without ever reading the merchant's actual key.
  Deno.env.get = (name) => name === "FILEY_AI_DEEPSEEK_KEY" ? "synthetic-test-key" : undefined;
  globalThis.fetch = (url, init) => {
    assertEquals(String(url), "https://api.deepseek.com/chat/completions");
    assertEquals(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-key");
    const request = JSON.parse(String(init?.body)) as Row;
    requests.push(request);
    return Promise.resolve(new Response(JSON.stringify(respond(request, requests.length - 1)), { status: 200 }));
  };
  try { await run(requests); }
  finally {
    globalThis.fetch = previousFetch;
    Deno.env.get = previousGet;
  }
}

const invoiceInput = { customer_name: "Fixture customer", items: [{ description: "Fixture item", qty: 2, unit_price: 10 }] };
const useTool = (id: string, name: string, input: unknown) => ({ type: "function", id, function: { name, arguments: JSON.stringify(input) } });
const response = (toolCalls: unknown[] = [], text = "") => ({
  id: "fixture-completion", model: "deepseek-flash",
  usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  choices: [{ message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls, reasoning_content: "Private fixture reasoning" } : {}) } }],
});

Deno.test("hosted unsupported invoice calculation cannot be retried with flattened quantities", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    const reply = await aiReply("Create a manual amount invoice", "Owner", client, state.org, OWNER_ID, "whatsapp", "971500000000", () => Promise.resolve(true));
    assertStringIncludes(reply, "keep your quantities, rates and calculation fields unchanged");
    assertEquals(state.rpcCalls, 0);
    assertEquals(requests.length, 1);
  }, () => response([
    useTool("manual", "create_draft_invoice", { ...invoiceInput, items: [{ ...invoiceInput.items[0], custom: { __manual_amount: "12" } }] }),
    useTool("flattened", "create_draft_invoice", invoiceInput),
  ]));
});

Deno.test("hosted final answer keeps a safe actionable validation cause without inventing a saved draft", async () => {
  const { client, state } = database();
  state.draftError = "Multiple customers match this name. Choose the customer in Filey";
  await providerTest(async () => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "whatsapp", "971500000000", () => Promise.resolve(true));
    assertStringIncludes(reply, state.draftError);
    assertStringIncludes(reply, "No draft was saved by this action");
    assertEquals(reply.includes("DEMO-42"), false);
    assertEquals(reply.includes("may already"), false);
  }, (_request, round) => round === 0 ? response([useTool("one", "create_draft_invoice", invoiceInput)]) : response([], "Draft DEMO-42 is ready."));
});

Deno.test("hosted model loop executes repeated successful draft calls once across batches and rounds", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "whatsapp", "971500000000", async () => true);
    assertEquals(reply, "Draft DEMO-42 is ready.");
    assertEquals(state.rpcCalls, 1);
    assertEquals(requests.length, 3);
    const messages = requests[2].messages as Row[];
    const receipts = messages.filter(message => message.role === "tool");
    assertEquals(receipts.length, 3);
    for (const receipt of receipts) assertEquals(JSON.parse(String(receipt.content)).number, "DEMO-42");
    assertEquals(state.walletCalls.map(call => call.p_action), ["reserve", "settle", "reserve", "settle", "reserve", "settle"]);
    assertEquals(new Set(state.walletCalls.filter(call => call.p_action === "reserve").map(call => (call.p_args as Row).run_id)).size, 1);
    assertEquals(requests[0].model, "deepseek-flash");
    assertStringIncludes(JSON.stringify(messages), "Private fixture reasoning");
    assertEquals(reply.includes("Private fixture reasoning"), false);
  }, (_request, round) => round === 0
    ? response([useTool("one", "create_draft_invoice", invoiceInput), useTool("two", "create_draft_invoice", invoiceInput)])
    : round === 1 ? response([useTool("three", "create_draft_invoice", invoiceInput)])
    : response([], "Draft DEMO-42 is ready."));
});

Deno.test("a lost hosted additive save stops before another model call or tool block can retry it", async () => {
  const { client, state } = database();
  state.lostInsert = true;
  await providerTest(async requests => {
    const reply = await aiReply("Add a fixture customer", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true);
    assertStringIncludes(reply, "save was not confirmed");
    assertEquals(requests.length, 1);
    assertEquals(state.inserts.filter(([table]) => table === "crm_customers").length, 1);
  }, () => response([useTool("one", "add_customer", { name: "Fixture" }), useTool("two", "add_customer", { name: "Fixture" })]));
});

Deno.test("hosted replies cannot claim a failed invoice action succeeded", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "telegram", "42", () => Promise.resolve(true));
    assertEquals(reply.includes("Draft DEMO-42 is ready"), false);
    assertStringIncludes(reply, "couldn't verify completion");
    assertEquals(state.rpcCalls, 0);
    assertEquals(requests.length, 2);
  }, (_request, round) => round === 0
    ? response([useTool("one", "create_draft_invoice", { ...invoiceInput, items: [] })])
    : response([], "Draft DEMO-42 is ready."));
});

Deno.test("hosted correction after a failed attempt reports only confirmed receipts", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "telegram", "42", () => Promise.resolve(true));
    assertStringIncludes(reply, "Confirmed results in Filey:");
    assertStringIncludes(reply, "Draft DEMO-42");
    assertEquals(reply.includes("DEMO-99"), false);
    assertEquals(state.rpcCalls, 1);
    assertEquals(requests.length, 3);
  }, (_request, round) => round === 0
    ? response([useTool("one", "create_draft_invoice", { ...invoiceInput, items: [] })])
    : round === 1 ? response([useTool("two", "create_draft_invoice", invoiceInput)])
    : response([], "Drafts DEMO-42 and DEMO-99 are ready."));
});

Deno.test("a provider failure after a confirmed save reports its receipt without running the write again", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true);
    assertStringIncludes(reply, "couldn't finish");
    assertStringIncludes(reply, "Confirmed results in Filey:");
    assertStringIncludes(reply, "Draft DEMO-42");
    assertEquals(state.rpcCalls, 1);
    assertEquals(requests.length, 2);
    assertEquals(state.walletCalls.map(call => call.p_action), ["reserve", "settle", "reserve", "release"]);
  }, (_request, round) => {
    if (round) throw new Error("synthetic provider failure");
    return response([useTool("one", "create_draft_invoice", invoiceInput)]);
  });
});

Deno.test("a provider failure after a workspace switch never reveals an earlier successful save receipt", async () => {
  const { client, state } = database();
  await providerTest(async () => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, "personal-org", OWNER_ID, "telegram", "42", async () => true);
    assertStringIncludes(reply, "workspace access changed");
    assertEquals(reply.includes("DEMO-42"), false);
    assertEquals(state.rpcCalls, 1);
  }, (_request, round) => {
    if (round) { state.org = "new-org"; throw new Error("synthetic provider failure"); }
    return response([useTool("one", "create_draft_invoice", invoiceInput)]);
  });
});

Deno.test("revoking hosted admin access while the model responds prevents every proposed write", async () => {
  const { client, state } = database();
  await providerTest(async () => {
    const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true);
    assertStringIncludes(reply, "workspace access changed");
    assertEquals(state.rpcCalls, 0);
  }, () => {
    state.role = "member";
    return response([useTool("one", "create_draft_invoice", invoiceInput)]);
  });
});

Deno.test("disconnect or re-pair while the model responds stops writes and private replies while settling prior usage", async () => {
  for (const enabled of [false, true]) {
    const { client, state } = database();
    const actor = { channel: "telegram" as const, externalId: "42", body: "Create an invoice", fromName: "Fixture" };
    state.rows.agent_channels = [{ user_id: OWNER_ID, provider: "telegram", enabled: true, owner_ref: "42", credentials: {} }];
    await providerTest(async requests => {
      const reply = await aiReply(actor.body, actor.fromName, client, state.org, OWNER_ID, actor.channel, actor.externalId,
        () => channelActorAllowed(client, OWNER_ID, actor, { env: () => undefined }));
      assertStringIncludes(reply, "assistant connection changed");
      assertEquals(reply.includes("Private fixture answer"), false);
      assertEquals(state.rpcCalls, 0);
      assertEquals(requests.length, 1);
      assertEquals(state.walletCalls.map(call => call.p_action), ["reserve", "settle"]);
    }, () => {
      state.rows.agent_channels[0] = { ...state.rows.agent_channels[0], enabled, owner_ref: "43" };
      return response([useTool("one", "create_draft_invoice", invoiceInput)], "Private fixture answer");
    });
  }
});

Deno.test("a workspace change during a committed tool suppresses its old-workspace receipt and remaining writes", async () => {
  const { client, state } = database();
  state.afterWrite = () => { state.org = "new-org"; };
  await providerTest(async requests => {
    const reply = await aiReply("Create fixture invoices", "Owner", client, "personal-org", OWNER_ID, "whatsapp", "971500000000", async () => true);
    assertStringIncludes(reply, "workspace access changed");
    assertEquals(reply.includes("DEMO-42"), false);
    assertEquals(state.rpcCalls, 1);
    assertEquals(requests.length, 1);
  }, () => response([useTool("one", "create_draft_invoice", invoiceInput), useTool("two", "create_draft_invoice", { ...invoiceInput, customer_name: "Other fixture" })]));
});

Deno.test("hosted context keeps personal workspace history while excluding former organizations and legacy unscoped turns", async () => {
  const { client, state } = database();
  const base = { user_id: OWNER_ID, channel: "telegram", external_id: "42" };
  state.rows.channel_messages = [
    { ...base, direction: "out", body: "Current answer", raw: { org_id: "personal-org" } },
    { ...base, direction: "in", body: "Current question", raw: { org_id: "personal-org" } },
    { ...base, direction: "in", body: "Former team private invoice", raw: { org_id: "former-team" } },
    { ...base, direction: "in", body: "Unknown legacy private invoice", raw: {} },
    { ...base, user_id: "someone-else", direction: "in", body: "Other owner", raw: { org_id: "personal-org" } },
  ];
  state.rows.agent_memories = [
    { user_id: OWNER_ID, org_id: "personal-org", text: "Current preference" },
    { user_id: OWNER_ID, org_id: "former-team", text: "Former team private balance" },
  ];
  assertEquals(await recentHistory(client, OWNER_ID, "personal-org", "telegram", "42"), [
    { role: "user", content: "Current question" }, { role: "assistant", content: "Current answer" },
  ]);
  assertEquals(await loadMemories(client, OWNER_ID, "personal-org", ""), ["Current preference"]);
  assertEquals(await recallMemories(client, "personal-org", OWNER_ID, {}), [state.rows.agent_memories[0]]);
  await providerTest(async requests => {
    await aiReply("Hello", "Owner", client, "personal-org", OWNER_ID, "telegram", "42", async () => true);
    const prompt = JSON.stringify(requests[0]);
    assertStringIncludes(prompt, "Current preference");
    assertStringIncludes(prompt, "Current question");
    assertEquals(prompt.includes("Former team"), false);
    assertEquals(prompt.includes("Unknown legacy"), false);
  }, () => response([], "Hello"));
});

Deno.test("memory correction cannot rewrite the same owner's former-workspace memory", async () => {
  const { client, state } = database();
  state.rows.agent_memories = [{ id: "old-team-memory", user_id: OWNER_ID, org_id: "former-team", text: "Private old fact" }];
  const result = await rememberMemory(client, "personal-org", OWNER_ID, { text: "Changed fact", replace_id: "old-team-memory" }) as { error?: string };
  assertStringIncludes(String(result.error), "not found");
  assertEquals(state.inserts.length, 0);
});

Deno.test("hosted channel billing refuses insufficient Coins before inference or business writes", async () => {
  for (const channel of ["telegram", "whatsapp"] as const) {
    const { client, state } = database();
    state.walletError = "Not enough available AI credits for this request. Add credits or lower the output limit.";
    await providerTest(async requests => {
      const reply = await aiReply("Create a fixture invoice", "Owner", client, state.org, OWNER_ID, channel, "42", async () => true, "update-1");
      assertEquals(reply, "Insufficient credit. Add Coin to continue.");
      assertEquals(requests.length, 0);
      assertEquals(state.rpcCalls, 0);
      assertEquals(state.inserts.length, 0);
      assertEquals(state.walletCalls.length, 1);
      assertEquals(state.walletCalls[0].p_user, OWNER_ID);
    }, () => response([useTool("one", "create_draft_invoice", invoiceInput)]));
  }
});

Deno.test("hosted billing guidance never forwards arbitrary wallet errors", async () => {
  const { client, state } = database();
  state.walletError = "Not enough available AI credits for this request. Add credits or lower the output limit. SQL SELECT private_rows";
  await providerTest(async requests => {
    const reply = await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true, "update-1");
    assertStringIncludes(reply, "couldn't reserve Coins");
    assertEquals(reply.includes("private_rows"), false);
    assertEquals(reply.includes("Insufficient credit"), false);
    assertEquals(requests.length, 0);
    assertEquals(state.walletCalls.length, 1);
  }, () => response([], "Must not infer"));
});

Deno.test("hosted channel billing never provides free inference for unverified or missing accounts", async () => {
  const { client, state } = database();
  state.confirmed = false;
  await providerTest(async requests => {
    assertStringIncludes(await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "whatsapp", "971500000000", async () => true), "Verify your Filey account's email");
    assertStringIncludes(await aiReply("Hello", "Owner", null, null, "", "telegram", "42", async () => true), "Connect your verified Filey account");
    assertEquals(requests.length, 0);
    assertEquals(state.walletCalls.length, 0);
  }, () => response([], "Hello"));
});

Deno.test("provider redelivery reuses wallet IDs while a later intentional message gets a new task", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    assertEquals(await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true, "update-1"), "Hello");
    assertStringIncludes(await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true, "update-1"), "couldn't reserve Coins");
    assertEquals(requests.length, 1);
    assertEquals(await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true, "update-2"), "Hello");
    assertEquals(requests.length, 2);
    const reservations = state.walletCalls.filter(call => call.p_action === "reserve").map(call => call.p_args as Row);
    assertEquals(reservations[0].request_id, reservations[1].request_id);
    assertEquals(reservations[0].run_id, reservations[1].run_id);
    assertEquals(reservations[0].run_id === reservations[2].run_id, false);
    assertEquals(state.walletCalls.filter(call => call.p_action === "settle").length, 2);
  }, () => response([], "Hello"));
});

Deno.test("missing hosted key cannot fall back to legacy Anthropic or OpenRouter configuration", async () => {
  const { client, state } = database();
  await providerTest(async requests => {
    Deno.env.get = (key) => ["ANTHROPIC_API_KEY", "FILEY_AI_OPENROUTER_KEY"].includes(key) ? "synthetic-legacy-key" : undefined;
    const reply = await aiReply("Hello", "Owner", client, state.org, OWNER_ID, "telegram", "42", async () => true);
    assertStringIncludes(reply, "couldn't finish");
    assertEquals(requests.length, 0);
    assertEquals(state.walletCalls.length, 0);
  }, () => response([], "This response must never be returned."));
});
