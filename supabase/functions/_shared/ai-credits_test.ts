import {
  chargedMicros,
  type CreditModel,
  creditModels,
  creditPacks,
  creditTopupCents,
  customCreditProduct,
  prepareCreditRequest,
  requireModelFunding,
  selectedCreditModel,
  TOPUP_FEE_CENTS,
} from "./ai-credits.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function rejects(fn: () => unknown) {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  assert(failed);
}
const model: CreditModel = {
  id: "fixture/chat",
  name: "Chat",
  input: 0.000001,
  output: 0.000003,
  context: 32768,
  maxOutput: 4096,
  vision: true,
};
Deno.test("paid model choice stays explicit and incompatible requests never substitute models", () => {
  const cheap = {
    ...model,
    id: "fixture/cheap",
    input: 0.0000001,
    output: 0.0000002,
    vision: false,
    context: 2048,
  };
  const expensive = {
    ...model,
    id: "fixture/premium",
    input: 0.00002,
    output: 0.00004,
  };
  const free = {
    ...cheap,
    id: "fixture/free",
    input: 0,
    output: 0,
    free: true,
  };
  const candidates = [expensive, model, cheap, free];
  const selected = selectedCreditModel(expensive.id, candidates);
  assert(
    selected === expensive,
    "A cheaper eligible model must not replace the user's choice",
  );
  assert(
    prepareCreditRequest(
      { messages: [{ role: "user", content: "Hi" }] },
      selected,
    ).request.model === expensive.id,
  );
  rejects(() =>
    prepareCreditRequest({
      messages: [{ role: "user", content: "x".repeat(1500) }],
      max_tokens: 32,
    }, cheap)
  );
  const image = {
    messages: [{
      role: "user",
      content: [{
        type: "image_url",
        image_url: { url: "data:image/png;base64,YWJj" },
      }],
    }],
  };
  rejects(() =>
    prepareCreditRequest(image, selectedCreditModel(cheap.id, candidates))
  );
  for (const id of [undefined, null, "fixture/missing", "filey-ai"]) {
    rejects(() => selectedCreditModel(id, candidates));
  }
  try {
    selectedCreditModel("filey-ai", candidates);
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes("Choose an AI model"),
    );
  }
});
Deno.test("catalogue includes compatible paid and free models but rejects incomplete or extra pricing", () => {
  const row = {
    id: "fixture/new-model",
    name: "New",
    supported_parameters: ["tools"],
    context_length: 32768,
    architecture: { output_modalities: ["text"] },
    pricing: { prompt: "0.000001", completion: "0.000002" },
  };
  const list = creditModels([
    row,
    { ...row, id: "fixture/zero", pricing: { prompt: "0", completion: "0" } },
    {
      ...row,
      id: "fixture/no-price",
      pricing: { prompt: null, completion: "0" },
    },
    {
      ...row,
      id: "fixture/blank-price",
      pricing: { prompt: "", completion: "0" },
    },
    {
      ...row,
      id: "fixture/negative",
      pricing: { ...row.pricing, image: "-1" },
    },
    {
      ...row,
      id: "fixture/extra-fee",
      pricing: { ...row.pricing, request: "0.1" },
    },
    { ...row, id: "fixture/unsupported", supported_parameters: "tools" },
    {
      ...row,
      id: "fixture/image-output",
      architecture: { output_modalities: ["text", "image"] },
    },
    { ...row, id: "fixture/model:batch" },
  ]);
  assert(list.length === 2 && list[0].free && list[1].id === row.id);
  assert(
    creditModels([row], new Set()).length === 0,
    "An explicit restricted list still works",
  );
  assert(creditModels([row], new Set([row.id]))[0]?.id === row.id);
});
Deno.test("live catalogue pricing shapes bound time tiers, reachable contexts, image and reasoning fees", () => {
  const row = {
    supported_parameters: ["tools", "reasoning"],
    context_length: 1048576,
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  };
  const models = creditModels([
    {
      ...row,
      id: "openai/gpt-6-luna",
      pricing: {
        prompt: "0.0000001",
        completion: "0.0000005",
        web_search: "0.01",
        input_cache_write: "0.000000125",
        overrides: [{
          min_prompt_tokens: 272000,
          prompt: "0.0000002",
          completion: "0.00000075",
          input_cache_write: "0.00000025",
        }],
      },
    },
    {
      ...row,
      id: "deepseek/deepseek-v4.1-flash",
      pricing: {
        prompt: "0.00000015",
        completion: "0.0000006",
        overrides: [{
          utc_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          utc_start: 100,
          utc_end: 400,
          prompt: "0.0000003",
          completion: "0.0000012",
        }, {
          utc_days: ["saturday", "sunday"],
          prompt: "0.00000015",
          completion: "0.0000006",
        }],
      },
    },
    {
      ...row,
      id: "google/gemini-3.5-flash-lite",
      pricing: {
        prompt: "0.0000003",
        completion: "0.0000025",
        image: "0.0000003",
        audio: "0.0000003",
        input_audio_cache: "0.00000003",
        web_search: "0.014",
        internal_reasoning: "0.0000025",
      },
    },
    {
      ...row,
      id: "fixture/tiered",
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        internal_reasoning: "0.000003",
        overrides: [{
          min_prompt_tokens: 32000,
          prompt: "0.000002",
          completion: "0.000004",
        }],
      },
    },
  ]);
  assert(models.length === 4);
  const luna = selectedCreditModel("openai/gpt-6-luna", models);
  assert(
    luna.input === 0.0000001 && luna.output === 0.0000005 &&
      luna.disableCacheWrites,
  );
  const flash = selectedCreditModel("deepseek/deepseek-v4.1-flash", models);
  assert(flash.input === 0.0000003 && flash.output === 0.0000012);
  const gemini = selectedCreditModel("google/gemini-3.5-flash-lite", models);
  assert(
    gemini.input === 0.0000003 && gemini.output === 0.0000025 &&
      gemini.image === 0.0000003,
  );
  const tiered = selectedCreditModel("fixture/tiered", models);
  assert(tiered.input === 0.000002 && tiered.output === 0.000004);
  const image = {
    type: "image_url",
    image_url: { url: "data:image/png;base64,YWJj" },
  };
  const prepared = prepareCreditRequest({
    messages: [{ role: "user", content: [image, image] }],
  }, { ...gemini, image: 0.01 });
  const withoutImageFee = prepareCreditRequest({
    messages: [{ role: "user", content: [image, image] }],
  }, { ...gemini, image: 0 });
  assert(Math.abs(prepared.reserve - withoutImageFee.reserve - 20000) <= 1);
  assert(prepared.request.provider.max_price.image === 0.01);
  const highReasoning = creditModels([{
    ...row,
    id: "fixture/reasoning",
    pricing: {
      prompt: "0.000001",
      completion: "0.000002",
      internal_reasoning: "0.000004",
    },
  }])[0];
  assert(
    highReasoning.output === 0.000004,
    "Reasoning output cannot exceed the reserved per-token rate",
  );
});
Deno.test("unknown charges and malformed pricing overrides never enter the catalogue", () => {
  const row = {
    id: "fixture/pricing",
    supported_parameters: ["tools"],
    context_length: 32768,
  };
  const base = { prompt: "0.000001", completion: "0.000002" };
  for (
    const pricing of [
      { ...base, request: "0.01" },
      { ...base, web_search: "bad" },
      { ...base, overrides: {} },
      { ...base, overrides: [null] },
      { ...base, overrides: [{ prompt: "-1" }] },
      { ...base, overrides: [{ prompt: "NaN" }] },
      { ...base, overrides: [{ request: "0.01" }] },
      {
        ...base,
        overrides: [{ min_prompt_tokens: "32000", prompt: "0.000002" }],
      },
      { ...base, overrides: [{ utc_days: ["holiday"], prompt: "0.000002" }] },
      { ...base, overrides: [{ utc_start: 1060, utc_end: 1200 }] },
      { ...base, overrides: [{ utc_end: 2400 }] },
    ]
  ) assert(creditModels([{ ...row, pricing }]).length === 0);
  assert(
    creditModels([{
      ...row,
      pricing: {
        ...base,
        overrides: [{ min_prompt_tokens: 300000, request: "1" }],
      },
    }]).length === 0,
    "Unrecognized fees must not be hidden inside an unreachable tier",
  );
});
Deno.test("custom credit amounts accept only integer cents within the configured range", () => {
  for (const amount of [500, 501, 1234, 10000]) {
    assert(creditTopupCents(amount) === amount);
  }
  for (
    const amount of [
      undefined,
      null,
      "500",
      "5.00",
      499,
      10001,
      500.5,
      NaN,
      Infinity,
      {},
      true,
    ]
  ) {
    rejects(() => creditTopupCents(amount));
  }
  assert(customCreditProduct("pdt_fixture") === "pdt_fixture");
  for (
    const product of [
      "",
      "any-product",
      "pdt_",
      " pdt_fixture",
      "pdt_fixture/other",
    ]
  ) {
    assert(customCreditProduct(product) === null);
  }
});
Deno.test("assistant reasoning survives tool continuation unchanged and counts toward the reserve", () => {
  const details = [
    {
      type: "reasoning.summary",
      summary: "Read the invoice first.",
      id: "summary-1",
      format: "openai-responses-v1",
      index: 0,
    },
    {
      type: "reasoning.encrypted",
      data: "YWJj",
      id: null,
      format: "openai-responses-v1",
      index: 1,
    },
    {
      type: "reasoning.text",
      text: "Need the customer's invoice.",
      signature: "signed-original",
      id: "text-1",
      index: 2,
    },
  ];
  const assistant = {
    role: "assistant",
    content: null,
    reasoning: "Need the customer's invoice.",
    reasoning_content: "Need the customer's invoice.",
    reasoning_details: details,
    tool_calls: [{
      id: "tool-1",
      type: "function",
      function: { name: "read_invoice", arguments: '{"id":1}' },
    }],
  };
  const tool = {
    role: "tool",
    tool_call_id: "tool-1",
    content: "Invoice found",
  };
  const request = prepareCreditRequest({ messages: [assistant, tool] }, model);
  assert(
    JSON.stringify(request.request.messages[0]) === JSON.stringify(assistant),
  );
  assert(
    request.request.messages[1].tool_call_id === tool.tool_call_id &&
      request.request.messages[1].content === tool.content,
  );
  const withoutReasoning = prepareCreditRequest({
    messages: [
      {
        role: assistant.role,
        content: assistant.content,
        tool_calls: assistant.tool_calls,
      },
      tool,
    ],
  }, model);
  assert(
    request.reserve > withoutReasoning.reserve,
    "Reasoning is included in the input cost bound",
  );
  assert(
    JSON.stringify(assistant.reasoning_details) === JSON.stringify(details),
    "Original blocks stay unchanged",
  );
  const nullMetadata = prepareCreditRequest({
    messages: [{
      role: "assistant",
      content: "Done",
      reasoning: null,
      reasoning_details: null,
    }],
  }, model);
  assert(
    "reasoning_details" in nullMetadata.request.messages[0] &&
      nullMetadata.request.messages[0].reasoning_details === null,
  );
});
Deno.test("malformed or misplaced reasoning metadata is rejected instead of silently stripped", () => {
  const block = {
    type: "reasoning.text",
    text: "Reasoning",
    signature: null,
    id: null,
  };
  for (
    const fields of [
      { reasoning: {} },
      { reasoning_content: [] },
      { reasoning: "x".repeat(262145) },
      { reasoning_details: {} },
      { reasoning_details: [null] },
      {
        reasoning_details: [{
          type: "image_url",
          image_url: { url: "https://private.example" },
        }],
      },
      { reasoning_details: [{ ...block, url: "https://private.example" }] },
      { reasoning_details: [{ ...block, signature: {} }] },
      { reasoning_details: [{ ...block, index: -1 }] },
      { reasoning_details: [{ ...block, index: 0.5 }] },
      { reasoning_details: [{ ...block, text: null }] },
      { reasoning_details: Array.from({ length: 129 }, () => block) },
      { reasoning_details: [{ ...block, text: "x".repeat(262145) }] },
    ]
  ) {
    rejects(() =>
      prepareCreditRequest({
        messages: [{ role: "assistant", content: "Hi", ...fields }],
      }, model)
    );
  }
  for (const role of ["user", "system", "tool"]) {
    rejects(() =>
      prepareCreditRequest({
        messages: [{ role, content: "Hi", reasoning_details: [block] }],
      }, model)
    );
  }
});
Deno.test("GPT-5.6 and newer cannot add automatic cache-write fees or caller cache markers", () => {
  const body = {
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: "Hi",
        cache_control: { type: "ephemeral" },
        prompt_cache_breakpoint: { mode: "explicit" },
      }],
    }],
    prompt_cache_options: { mode: "automatic", ttl: "1h" },
    cache_control: { type: "ephemeral" },
    tools: [{
      type: "function",
      cache_control: { type: "ephemeral" },
      function: {
        name: "read_invoice",
        parameters: { type: "object" },
        cache_control: { type: "ephemeral" },
      },
    }],
  };
  for (
    const id of [
      "openai/gpt-5.6",
      "openai/gpt-5.6-sol",
      "openai/gpt-6-luna",
      "openai/gpt-10",
    ]
  ) {
    const request = prepareCreditRequest(body, { ...model, id }).request;
    assert(
      JSON.stringify(request.prompt_cache_options) === '{"mode":"explicit"}',
    );
    assert(!("cache_control" in request));
    assert(
      JSON.stringify(request.messages[0].content) ===
        '[{"type":"text","text":"Hi"}]',
    );
    assert(
      JSON.stringify(request.tools) ===
        '[{"type":"function","function":{"name":"read_invoice","parameters":{"type":"object"}}}]',
    );
  }
  for (
    const id of [
      "openai/gpt-5.5",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4",
    ]
  ) {
    assert(
      !("prompt_cache_options" in
        prepareCreditRequest(body, { ...model, id }).request),
    );
  }
  assert(
    prepareCreditRequest(body, {
      ...model,
      id: "~openai/gpt-luna-latest",
      disableCacheWrites: true,
    }).request.prompt_cache_options?.mode === "explicit",
  );
});
Deno.test(
  "credits use micro-unit rounding, validate packs and reject unverified costs",
  () => {
    assert(TOPUP_FEE_CENTS === 50, "The only service fee is charged at top-up");
    assert(chargedMicros(0.000001) === 1);
    assert(
      chargedMicros(0.0000001) === 1,
      "Sub-micro costs round up without a markup",
    );
    assert(chargedMicros(0.1) === 100000);
    assert(chargedMicros(0) === 0);
    for (const cost of [NaN, Infinity, -1, 1001]) {
      rejects(() => chargedMicros(cost));
    }
    assert(creditPacks('[{"id":"pdt_abc","cents":500}]')[0].cents === 500);
    for (
      const input of [
        "{}",
        '[{"id":"anything","cents":500}]',
        '[{"id":"pdt_abc","cents":0}]',
        '[{"id":"pdt_abc","cents":500},{"id":"pdt_abc","cents":500}]',
      ]
    ) {
      rejects(() => creditPacks(input));
    }
  },
);

Deno.test("free catalogue verifies zero pricing and cannot silently become paid", () => {
  const row = {
    id: "fixture/model:free",
    name: "Free",
    context_length: 32768,
    supported_parameters: ["tools"],
    pricing: { prompt: "0", completion: "0" },
  };
  const list = creditModels(
    [
      row,
      { ...row, id: "openrouter/free" },
      {
        ...row,
        id: "fixture/paid:free",
        pricing: { prompt: "0.1", completion: "0" },
      },
      {
        ...row,
        id: "fixture/extra:free",
        pricing: { ...row.pricing, image: "0.1" },
      },
      { ...row, id: "fixture/no-tools:free", supported_parameters: [] },
    ],
    new Set(),
  );
  assert(list.length === 2 && list[0].id === "openrouter/free");
  const free = list[0];
  requireModelFunding("free", free);
  rejects(() => requireModelFunding("free", model));
  rejects(() => requireModelFunding("credits", free));
  rejects(() => requireModelFunding(undefined, free));
  const request = prepareCreditRequest(
    {
      messages: [{ role: "user", content: "Hi" }],
      plugins: [{ id: "web" }],
      reasoning_effort: "high",
    },
    free,
  );
  assert(
    request.reserve === 0 &&
      request.request.provider.max_price.prompt === 0 &&
      request.request.provider.max_price.completion === 0,
  );
  assert(!("plugins" in request.request) && !("reasoning" in request.request));
});
Deno.test(
  "paid requests strip expensive routing/plugins and bound all output including reasoning",
  () => {
    const result = prepareCreditRequest(
      {
        messages: [{ role: "user", content: "Hello" }],
        model: "attacker/model",
        max_completion_tokens: 50000,
        provider: { order: ["attacker"] },
        plugins: [{ id: "web" }],
        reasoning_effort: "high",
      },
      model,
    );
    assert(result.request.model === model.id);
    assert(result.request.max_tokens === 4096);
    assert(!("plugins" in result.request));
    assert(result.request.provider.max_price.prompt === 1);
    assert(result.reserve > 4096 * model.output * 1000000);
    rejects(() =>
      prepareCreditRequest(
        {
          messages: [{
            role: "user",
            content: [{ type: "input_audio", data: "audio" }],
          }],
        },
        model,
      )
    );
    rejects(() =>
      prepareCreditRequest(
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "https://private.example" },
                },
              ],
            },
          ],
        },
        model,
      )
    );
    rejects(() =>
      prepareCreditRequest(
        { messages: [{ role: "user", content: "x".repeat(40000) }] },
        model,
      )
    );
    rejects(() =>
      prepareCreditRequest(
        {
          messages: [{ role: "user", content: "x" }],
          tools: [{ type: "web_search" }],
        },
        model,
      )
    );
    const image = prepareCreditRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,YWJj" },
              },
            ],
          },
        ],
      },
      model,
    );
    assert(
      image.reserve > result.reserve,
      "Vision reserves a conservative context allowance",
    );
  },
);
