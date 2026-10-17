import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES, cardFromArgs, viewFromArgs } from "../genUi";

// Cards and widgets are drawn from model output: the parsers are the gate.
describe("generative UI parsers", () => {
  it("accepts OpenIntelligentUI's card format and rejects bad cards", () => {
    const card = cardFromArgs({ title: "T", html: "<p>x</p>", jsExpressions: ["go()", 4], images: [{ name: "hero", source: "media:x" }, { name: "" }], initialHeight: 99999 });
    expect(card).toMatchObject({ title: "T", jsExpressions: ["go()"], images: [{ name: "hero", source: "media:x" }], initialHeight: 1600 });
    expect(cardFromArgs({ html: " " })).toBe("Give the card's html.");
    expect(cardFromArgs({ html: "x".repeat(170_000) })).toMatch(/under 160 KB/);
  });

  it("checks widget data before it is drawn", () => {
    expect(viewFromArgs({ view: "bar", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] })).toMatchObject({ kind: "view", view: "bar" });
    expect(viewFromArgs({ view: "bar", labels: ["a", "b"], series: [{ name: "s", values: [1] }] })).toMatch(/one finite number per label/);
    expect(viewFromArgs({ view: "pie", labels: ["a"], values: [-1] })).toMatch(/non-negative/);
    expect(viewFromArgs({ view: "choices", options: [] })).toMatch(/at least one option/);
    expect(viewFromArgs({ view: "nope" })).toMatch(/view must be one of/);
  });

  it("ships built-in templates that parse as cards", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(typeof cardFromArgs({ title: t.name, ...t.card })).toBe("object");
  });
});
