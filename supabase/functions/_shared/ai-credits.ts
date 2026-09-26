/** USD micro-units: never use a mutable client balance for billing. */
export const MICROS = 1_000_000;
export const TOPUP_FEE_CENTS = 50;
export const MIN_TOPUP_CENTS = 500;
export const MAX_TOPUP_CENTS = 10000;
export const FREE_REQUESTS_PER_DAY = 20;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type CreditModel = {
  id: string;
  name: string;
  input: number;
  output: number;
  image?: number;
  disableCacheWrites?: boolean;
  context: number;
  maxOutput: number;
  vision: boolean;
  free?: boolean;
  reasoning?: boolean;
};
export type CreditPack = { id: string; cents: number };

/** Only a server-configured product can be used for variable-price checkouts. */
export function customCreditProduct(raw: string): string | null {
  return /^pdt_[a-zA-Z0-9]+$/.test(raw) ? raw : null;
}

export function creditTopupCents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MIN_TOPUP_CENTS ||
    value > MAX_TOPUP_CENTS
  ) {
    throw new Error(
      "Choose an AI credit amount from $5.00 to $100.00, in whole cents.",
    );
  }
  return value;
}

export function creditPacks(raw: string): CreditPack[] {
  if (!raw) return [];
  const packs: unknown = JSON.parse(raw);
  if (!Array.isArray(packs) || packs.length > 10) {
    throw new Error("Invalid credit packs");
  }
  const seen = new Set<string>();
  return packs.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^pdt_[a-zA-Z0-9]+$/.test(p.id) ||
      seen.has(p.id) ||
      !Number.isSafeInteger(p.cents) ||
      p.cents < MIN_TOPUP_CENTS ||
      p.cents > MAX_TOPUP_CENTS
    ) {
      throw new Error("Invalid credit pack");
    }
    seen.add(p.id);
    return { id: p.id, cents: p.cents };
  });
}

/** Upper bounds across reachable context/time tiers, not an estimated bill. */
function creditPrices(value: unknown, context: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const base = value as Record<string, unknown>;
  const overrides = base.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > 64) return null;
  const price = (v: unknown) =>
    (typeof v === "string" || typeof v === "number") &&
    String(v).trim() !== "" &&
    Number.isFinite(Number(v)) && Number(v) >= 0;
  if (!price(base.prompt) || !price(base.completion)) return null;
  let input = Number(base.prompt),
    output = Number(base.completion),
    image = 0,
    cacheWrite = 0;
  const priceFields = [
    "prompt",
    "completion",
    "image",
    "internal_reasoning",
    "input_cache_read",
    "input_cache_write",
    "input_cache_write_1h",
    // These capabilities cannot be requested by the text/image/function sanitizer.
    "web_search",
    "audio",
    "audio_output",
    "input_audio_cache",
  ];
  for (const tier of [base, ...overrides]) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) return null;
    for (const [key, amount] of Object.entries(tier)) {
      if (key === "overrides" && tier === base) continue;
      if (tier !== base && key === "min_prompt_tokens") {
        if (!Number.isSafeInteger(amount) || Number(amount) < 0) return null;
      } else if (tier !== base && key === "utc_days") {
        if (
          !Array.isArray(amount) || !amount.length || amount.length > 7 ||
          amount.some((day) =>
            ![
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ].includes(day)
          )
        ) return null;
      } else if (tier !== base && (key === "utc_start" || key === "utc_end")) {
        if (
          !Number.isSafeInteger(amount) || Number(amount) < 0 ||
          Number(amount) > 2359 || Number(amount) % 100 >= 60
        ) return null;
      } else if (
        !price(amount) || (!priceFields.includes(key) && Number(amount) > 0)
      ) return null;
    }
    if (tier !== base && Number(tier.min_prompt_tokens) > context) continue;
    input = Math.max(
      input,
      Number(tier.prompt ?? 0),
      Number(tier.input_cache_read ?? 0),
    );
    output = Math.max(
      output,
      Number(tier.completion ?? 0),
      Number(tier.internal_reasoning ?? 0),
    );
    image = Math.max(image, Number(tier.image ?? 0));
    cacheWrite = Math.max(
      cacheWrite,
      Number(tier.input_cache_write ?? 0),
      Number(tier.input_cache_write_1h ?? 0),
    );
  }
  return { input, output, image, cacheWrite };
}

/** Rebuild from provider pricing: a ':free' name alone never grants free routing. */
export function creditModels(
  rows: unknown,
  allowed = new Set(["*"]),
): CreditModel[] {
  if (!Array.isArray(rows)) return [];
  const list: CreditModel[] = [];
  for (const m of rows) {
    if (
      typeof m?.id !== "string" ||
      m.id.endsWith(":batch") ||
      !Array.isArray(m.supported_parameters) ||
      !m.supported_parameters.includes("tools")
    ) {
      continue;
    }
    if (
      m.architecture?.output_modalities &&
      (!Array.isArray(m.architecture.output_modalities) ||
        m.architecture.output_modalities.some((modality: unknown) =>
          modality !== "text"
        ))
    ) {
      continue;
    }
    const context = Math.min(Number(m.context_length), 131072);
    if (!Number.isInteger(context) || context < 2048) continue;
    const prices = creditPrices(m.pricing, context);
    if (!prices) continue;
    const { input, output, image, cacheWrite } = prices;
    const free = input === 0 && output === 0 && image === 0 && cacheWrite === 0;
    if (
      !free &&
      ((!allowed.has("*") && !allowed.has(m.id)) || input + output <= 0)
    ) {
      continue;
    }
    const maxOutput = Math.min(
      Number(m.top_provider?.max_completion_tokens) || 8192,
      8192,
      context - 1024,
    );
    if (!Number.isInteger(context) || context < 2048 || maxOutput < 1) continue;
    list.push({
      id: m.id,
      name: String(m.name ?? m.id),
      input,
      output,
      ...(image > 0 ? { image } : {}),
      ...(cacheWrite > input && /^(?:~)?openai\//.test(m.id)
        ? { disableCacheWrites: true }
        : {}),
      context,
      maxOutput,
      vision: !!m.architecture?.input_modalities?.includes("image"),
      free,
      reasoning: m.supported_parameters.includes("reasoning"),
    });
  }
  return list.sort(
    (a, b) =>
      Number(b.id === "openrouter/free") - Number(a.id === "openrouter/free") ||
      Number(b.free) - Number(a.free) ||
      a.input + a.output - (b.input + b.output) ||
      a.name.localeCompare(b.name),
  );
}

/** Keep the user's explicit model choice; never replace it with a cheaper model. */
export function selectedCreditModel(
  id: unknown,
  models: CreditModel[],
): CreditModel {
  if (id === "filey-ai") {
    throw new Error(
      "Choose an AI model in the chat controls to continue using Paper.",
    );
  }
  const model = models.find((candidate) => candidate.id === id);
  if (!model) {
    throw new Error(
      "This model is unavailable. Choose an available AI model to continue.",
    );
  }
  return model;
}

export function requireModelFunding(funding: unknown, model: CreditModel) {
  // Missing funding is supported for older paid clients only.
  if (funding !== undefined && funding !== "credits" && funding !== "free") {
    throw new Error("Choose how to use Filey AI.");
  }
  if ((funding === "free") !== !!model.free) {
    throw new Error(
      "The model's pricing changed. Choose a model again; free mode never spends credits.",
    );
  }
}

export function chargedMicros(cost: number): number {
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    cost > 1000
  ) {
    throw new Error("Invalid provider usage cost");
  }
  return Math.ceil(cost * MICROS);
}

/** Only ordinary text/vision function-calling requests; no caller-selected
 * routes, paid plugins, audio, cache-write directives, or arbitrary URLs. */
export function prepareCreditRequest(
  body: Record<string, unknown>,
  model: CreditModel,
) {
  if (
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > 200
  ) {
    throw new Error("Send between 1 and 200 messages.");
  }
  let imageCount = 0;
  const messages = body.messages.map((m) => {
    if (!m || !["system", "user", "assistant", "tool"].includes(m.role)) {
      throw new Error("Unsupported message role.");
    }
    // Tool continuations must replay provider reasoning and signatures exactly.
    // Validate the flat response shape without rewriting or reordering it.
    const reasoning: Record<string, unknown> = {};
    for (
      const field of ["reasoning", "reasoning_content", "reasoning_details"]
    ) {
      const value = m[field];
      if (value === undefined) continue;
      if (m.role !== "assistant") {
        throw new Error(
          "Reasoning metadata is only supported on assistant messages.",
        );
      }
      if (value !== null) {
        if (field !== "reasoning_details") {
          if (typeof value !== "string" || value.length > 262144) {
            throw new Error("Invalid assistant reasoning metadata.");
          }
        } else if (
          !Array.isArray(value) || value.length > 128 ||
          JSON.stringify(value).length > 262144 ||
          value.some((block) => {
            if (
              !block || typeof block !== "object" || Array.isArray(block)
            ) return true;
            const contentField = block.type === "reasoning.summary"
              ? "summary"
              : block.type === "reasoning.text"
              ? "text"
              : block.type === "reasoning.encrypted"
              ? "data"
              : null;
            if (
              !contentField || typeof block[contentField] !== "string"
            ) return true;
            return Object.entries(block).some(([key, entry]) => {
              if (key === "index") {
                return !Number.isSafeInteger(entry) || Number(entry) < 0;
              }
              if (
                ![
                  "type",
                  "id",
                  "format",
                  "signature",
                  "summary",
                  "text",
                  "data",
                ].includes(key)
              ) return true;
              if (
                entry === null && (key === "id" || key === "signature")
              ) return false;
              return typeof entry !== "string";
            });
          })
        ) throw new Error("Invalid assistant reasoning metadata.");
      }
      reasoning[field] = value;
    }
    const content = m.content;
    if (
      typeof content !== "string" && content !== null && !Array.isArray(content)
    ) {
      throw new Error("Invalid message content.");
    }
    const clean = Array.isArray(content)
      ? content.map((b) => {
        if (b?.type === "text" && typeof b.text === "string") {
          return { type: "text", text: b.text };
        }
        if (
          b?.type === "image_url" &&
          model.vision &&
          typeof b.image_url?.url === "string" &&
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
            b.image_url.url,
          )
        ) {
          imageCount++;
          return { type: "image_url", image_url: { url: b.image_url.url } };
        }
        throw new Error(
          "This model supports text" +
            (model.vision
              ? " and attached PNG, JPEG or WebP images."
              : " only. Choose a vision model for images."),
        );
      })
      : content;
    if (
      m.tool_calls !== undefined &&
      (!Array.isArray(m.tool_calls) ||
        m.tool_calls.length > 64 ||
        m.tool_calls.some(
          (c: {
            id?: unknown;
            type?: unknown;
            function?: { name?: unknown; arguments?: unknown };
          }) =>
            typeof c.id !== "string" ||
            c.type !== "function" ||
            typeof c.function?.name !== "string" ||
            typeof c.function?.arguments !== "string",
        ))
    ) {
      throw new Error("Invalid tool calls.");
    }
    return {
      role: m.role,
      content: clean,
      ...reasoning,
      ...(typeof m.tool_call_id === "string"
        ? { tool_call_id: m.tool_call_id }
        : {}),
      ...(m.tool_calls
        ? {
          tool_calls: m.tool_calls.map(
            (
              c: { id: string; function: { name: string; arguments: string } },
            ) => ({
              id: c.id,
              type: "function",
              function: {
                name: c.function.name,
                arguments: c.function.arguments,
              },
            }),
          ),
        }
        : {}),
    };
  });
  let tools = body.tools;
  if (
    tools !== undefined &&
    (!Array.isArray(tools) ||
      tools.length > 200 ||
      tools.some(
        (t) =>
          t?.type !== "function" ||
          typeof t.function?.name !== "string" ||
          !t.function?.parameters ||
          typeof t.function.parameters !== "object",
      ))
  ) {
    throw new Error("Invalid function tools.");
  }
  if (tools) {
    tools = tools.map((tool: { function: Record<string, unknown> }) => ({
      type: "function",
      function: {
        name: tool.function.name,
        ...(typeof tool.function.description === "string"
          ? { description: tool.function.description }
          : {}),
        parameters: tool.function.parameters,
        ...(typeof tool.function.strict === "boolean"
          ? { strict: tool.function.strict }
          : {}),
      },
    }));
  }
  const requested = body.max_completion_tokens ?? body.max_tokens ?? 2048;
  if (!Number.isInteger(requested) || Number(requested) < 1) {
    throw new Error("Invalid output token limit.");
  }
  const maxTokens = Math.min(Number(requested), model.maxOutput, 8192);
  const inputBytes = new TextEncoder().encode(
    JSON.stringify({
      messages: messages.map((m) => ({
        ...m,
        content: Array.isArray(m.content)
          ? m.content.filter((b) => b.type === "text")
          : m.content,
      })),
      tools,
    }),
  ).length;
  const inputBound = imageCount > 0
    ? model.context - maxTokens
    : inputBytes * 2 + messages.length * 32 + 1024;
  if (inputBound + maxTokens > model.context) {
    throw new Error(
      "This conversation is too large for the selected model. Start a new chat or choose a larger-context model.",
    );
  }
  const reserve = model.free ? 0 : Math.max(
    1,
    chargedMicros(
      inputBound * model.input + maxTokens * model.output +
        imageCount * (model.image ?? 0),
    ),
  );
  const openAiVersion = /^openai\/gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(model.id);
  const disableCacheWrites = model.disableCacheWrites || openAiVersion &&
      (Number(openAiVersion[1]) > 5 ||
        (Number(openAiVersion[1]) === 5 && Number(openAiVersion[2]) >= 6));
  return {
    reserve,
    request: {
      model: model.id,
      messages,
      ...(tools ? { tools } : {}),
      stream: false,
      max_tokens: maxTokens,
      // GPT-5.6+ otherwise adds automatic cache-write costs above the input rate.
      // Content cache markers and caller cache options are never forwarded.
      ...(disableCacheWrites
        ? { prompt_cache_options: { mode: "explicit" } }
        : {}),
      ...(typeof body.temperature === "number" &&
          body.temperature >= 0 &&
          body.temperature <= 2
        ? { temperature: body.temperature }
        : {}),
      ...(model.reasoning !== false &&
          typeof body.reasoning_effort === "string" &&
          ["low", "medium", "high", "xhigh"].includes(body.reasoning_effort)
        ? { reasoning: { effort: body.reasoning_effort } }
        : {}),
      provider: {
        sort: "price",
        require_parameters: true,
        max_price: {
          prompt: model.input * MICROS,
          completion: model.output * MICROS,
          ...(model.image ? { image: model.image } : {}),
        },
      },
    },
  };
}
