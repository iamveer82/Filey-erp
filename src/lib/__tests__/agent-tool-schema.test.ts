import { describe, expect, it } from "vitest";
import { validateToolArgs } from "../agentToolSchema";

describe("tool argument boundary", () => {
  const schema = { type: "object", required: ["items"], additionalProperties: false, properties: {
    items: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", required: ["qty", "unit"], properties: {
      qty: { type: "integer", minimum: 1, maximum: 100 }, unit: { type: "string", enum: ["each", "box"] },
    } } },
  } };
  it("accepts valid records without coercing wrong amounts or dropping fields", () => {
    expect(validateToolArgs(schema, { items: [{ qty: 2, unit: "each" }] })).toBeNull();
    for (const input of [{}, { items: [] }, { items: [{ qty: "2", unit: "each" }] },
      { items: [{ qty: 0, unit: "each" }] }, { items: [{ qty: 2, unit: "unknown" }] },
      { items: [{ qty: 2, unit: "each" }], extra: true }]) expect(validateToolArgs(schema, input)).toBeTruthy();
  });
  it("bounds nested data and rejects prototype keys, including inside unspecified arrays", () => {
    expect(validateToolArgs({}, JSON.parse('{"rows":[{"__proto__":{}}]}'))).toContain("unsupported");
    let deep: unknown = "leaf";
    for (let i = 0; i < 34; i++) deep = [deep];
    expect(validateToolArgs({}, deep)).toContain("deeply nested");
    expect(validateToolArgs({}, { amount: Infinity })).toBeTruthy();
  });
});
