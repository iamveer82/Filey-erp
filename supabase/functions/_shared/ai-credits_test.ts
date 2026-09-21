import {
  chargedMicros,
  creditModels,
  requireModelFunding,
  markupBps,
  creditPacks,
  prepareCreditRequest,
  type CreditModel,
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
Deno.test(
  "credits use micro-unit rounding, validate packs and reject unverified costs",
  () => {
    assert(markupBps(undefined) === 0, "No usage markup after the top-up fee");
    assert(chargedMicros(0.000001, 2000) === 2);
    assert(chargedMicros(0.1, 2000) === 120000);
    for (const cost of [NaN, Infinity, -1, 1001])
      rejects(() => chargedMicros(cost, 2000));
    assert(creditPacks('[{"id":"pdt_abc","cents":500}]')[0].cents === 500);
    for (const input of [
      "{}",
      '[{"id":"anything","cents":500}]',
      '[{"id":"pdt_abc","cents":0}]',
      '[{"id":"pdt_abc","cents":500},{"id":"pdt_abc","cents":500}]',
    ])
      rejects(() => creditPacks(input));
  }
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
      { ...row, id: "fixture/paid:free", pricing: { prompt: "0.1", completion: "0" } },
      { ...row, id: "fixture/extra:free", pricing: { ...row.pricing, image: "0.1" } },
      { ...row, id: "fixture/no-tools:free", supported_parameters: [] },
    ],
    new Set()
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
    2000
  );
  assert(
    request.reserve === 0 &&
      request.request.provider.max_price.prompt === 0 &&
      request.request.provider.max_price.completion === 0
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
      2000
    );
    assert(result.request.model === model.id);
    assert(result.request.max_tokens === 4096);
    assert(!("plugins" in result.request));
    assert(result.request.provider.max_price.prompt === 1);
    assert(result.reserve > 4096 * model.output * 1200000);
    rejects(() =>
      prepareCreditRequest(
        {
          messages: [{ role: "user", content: [{ type: "input_audio", data: "audio" }] }],
        },
        model,
        2000
      )
    );
    rejects(() =>
      prepareCreditRequest(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: "https://private.example" } },
              ],
            },
          ],
        },
        model,
        2000
      )
    );
    rejects(() =>
      prepareCreditRequest(
        { messages: [{ role: "user", content: "x".repeat(40000) }] },
        model,
        2000
      )
    );
    rejects(() =>
      prepareCreditRequest(
        { messages: [{ role: "user", content: "x" }], tools: [{ type: "web_search" }] },
        model,
        2000
      )
    );
    const image = prepareCreditRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
            ],
          },
        ],
      },
      model,
      2000
    );
    assert(
      image.reserve > result.reserve,
      "Vision reserves a conservative context allowance"
    );
  }
);
