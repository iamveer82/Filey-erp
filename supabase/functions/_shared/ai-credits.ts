/** USD micro-units: never use a mutable client balance for billing. */
export const MICROS = 1_000_000;
export const TOPUP_FEE_CENTS = 50;
export const FREE_REQUESTS_PER_DAY = 20;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type CreditModel = {
  id: string;
  name: string;
  input: number;
  output: number;
  context: number;
  maxOutput: number;
  vision: boolean;
  free?: boolean;
  reasoning?: boolean;
};
export type CreditPack = { id: string; cents: number };

export function creditPacks(raw: string): CreditPack[] {
  if (!raw) return [];
  const packs: unknown = JSON.parse(raw);
  if (!Array.isArray(packs) || packs.length > 10) throw new Error("Invalid credit packs");
  const seen = new Set<string>();
  return packs.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^pdt_[a-zA-Z0-9]+$/.test(p.id) ||
      seen.has(p.id) ||
      !Number.isSafeInteger(p.cents) ||
      p.cents < 500 ||
      p.cents > 10000
    )
      throw new Error("Invalid credit pack");
    seen.add(p.id);
    return { id: p.id, cents: p.cents };
  });
}

export function markupBps(raw: string | undefined): number {
  const value = Number(raw ?? "0");
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new Error("Invalid AI service markup");
  return value;
}

/** Rebuild from provider pricing: a ':free' name alone never grants free routing. */
export function creditModels(rows: unknown, allowed: Set<string>): CreditModel[] {
  if (!Array.isArray(rows)) return [];
  const list: CreditModel[] = [];
  for (const m of rows) {
    if (typeof m?.id !== "string" || !m.supported_parameters?.includes("tools")) continue;
    const input = Number(m.pricing?.prompt),
      output = Number(m.pricing?.completion);
    if (![input, output].every((n) => Number.isFinite(n) && n >= 0)) continue;
    const free =
      (m.id === "openrouter/free" || m.id.endsWith(":free")) &&
      input === 0 &&
      output === 0 &&
      Object.values(m.pricing).every((v) => Number(v) === 0);
    if (!free && (!allowed.has(m.id) || input + output <= 0)) continue;
    if (
      Object.entries(m.pricing ?? {}).some(
        ([k, v]) =>
          !["prompt", "completion", "input_cache_read", "input_cache_write"].includes(
            k
          ) && Number(v) > 0
      )
    )
      continue;
    const context = Math.min(Number(m.context_length), 131072);
    const maxOutput = Math.min(
      Number(m.top_provider?.max_completion_tokens) || 8192,
      8192,
      context - 1024
    );
    if (!Number.isInteger(context) || context < 2048 || maxOutput < 1) continue;
    list.push({
      id: m.id,
      name: String(m.name ?? m.id),
      input,
      output,
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
      a.name.localeCompare(b.name)
  );
}

export function requireModelFunding(funding: unknown, model: CreditModel) {
  // Missing funding is supported for older paid clients only.
  if (funding !== undefined && funding !== "credits" && funding !== "free")
    throw new Error("Choose how to use Filey AI.");
  if ((funding === "free") !== !!model.free)
    throw new Error(
      "The model's pricing changed. Choose a model again; free mode never spends credits."
    );
}

export function chargedMicros(cost: number, markup: number): number {
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    cost > 1000 ||
    !Number.isInteger(markup) ||
    markup < 0 ||
    markup > 10000
  )
    throw new Error("Invalid provider usage cost");
  return Math.ceil(cost * MICROS * (1 + markup / 10000));
}

/** Only ordinary text/vision function-calling requests; no caller-selected
 * routes, paid plugins, audio, cache-write directives, or arbitrary URLs. */
export function prepareCreditRequest(
  body: Record<string, unknown>,
  model: CreditModel,
  markup: number
) {
  if (
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > 200
  )
    throw new Error("Send between 1 and 200 messages.");
  let hasImages = false;
  const messages = body.messages.map((m) => {
    if (!m || !["system", "user", "assistant", "tool"].includes(m.role))
      throw new Error("Unsupported message role.");
    const content = m.content;
    if (typeof content !== "string" && content !== null && !Array.isArray(content))
      throw new Error("Invalid message content.");
    const clean = Array.isArray(content)
      ? content.map((b) => {
          if (b?.type === "text" && typeof b.text === "string")
            return { type: "text", text: b.text };
          if (
            b?.type === "image_url" &&
            model.vision &&
            typeof b.image_url?.url === "string" &&
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(b.image_url.url)
          ) {
            hasImages = true;
            return { type: "image_url", image_url: { url: b.image_url.url } };
          }
          throw new Error(
            "This model supports text" +
              (model.vision
                ? " and attached PNG, JPEG or WebP images."
                : " only. Choose a vision model for images.")
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
            typeof c.function?.arguments !== "string"
        ))
    )
      throw new Error("Invalid tool calls.");
    return {
      role: m.role,
      content: clean,
      ...(typeof m.tool_call_id === "string" ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls
        ? {
            tool_calls: m.tool_calls.map(
              (c: { id: string; function: { name: string; arguments: string } }) => ({
                id: c.id,
                type: "function",
                function: { name: c.function.name, arguments: c.function.arguments },
              })
            ),
          }
        : {}),
    };
  });
  const tools = body.tools;
  if (
    tools !== undefined &&
    (!Array.isArray(tools) ||
      tools.length > 200 ||
      tools.some(
        (t) =>
          t?.type !== "function" ||
          typeof t.function?.name !== "string" ||
          !t.function?.parameters ||
          typeof t.function.parameters !== "object"
      ))
  )
    throw new Error("Invalid function tools.");
  const requested = body.max_completion_tokens ?? body.max_tokens ?? 2048;
  if (!Number.isInteger(requested) || Number(requested) < 1)
    throw new Error("Invalid output token limit.");
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
    })
  ).length;
  const inputBound = hasImages
    ? model.context - maxTokens
    : inputBytes * 2 + messages.length * 32 + 1024;
  if (inputBound + maxTokens > model.context)
    throw new Error(
      "This conversation is too large for the selected model. Start a new chat or choose a larger-context model."
    );
  const reserve = model.free
    ? 0
    : Math.max(
        1,
        chargedMicros(inputBound * model.input + maxTokens * model.output, markup)
      );
  return {
    reserve,
    request: {
      model: model.id,
      messages,
      ...(tools ? { tools } : {}),
      stream: false,
      max_tokens: maxTokens,
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
        max_price: { prompt: model.input * MICROS, completion: model.output * MICROS },
      },
    },
  };
}
