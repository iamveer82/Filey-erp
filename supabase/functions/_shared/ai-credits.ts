/** USD micro-units: never use a mutable client balance for billing. */
export const MICROS = 1_000_000;
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
  const value = Number(raw ?? "2000");
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new Error("Invalid AI service markup");
  return value;
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
  const reserve = Math.max(
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
      ...(typeof body.reasoning_effort === "string" &&
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
