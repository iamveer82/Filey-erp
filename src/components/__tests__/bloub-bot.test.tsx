import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import BloubBot from "../BloubBot";
import { botExpressionFor, botStateFor } from "../../lib/botMood";
import { STATES, type StateId } from "../../lib/bloub/states";
import { EXPRESSION_BY_ID } from "../../lib/bloub/expressions";

afterEach(cleanup);

/* The engine is vendored (src/lib/bloub) and its states are data, not code we
 * wrote — so what's worth pinning here is the seam: every state the mapping can
 * ask for still exists upstream, and each one actually draws something. A
 * re-copy from upstream that renamed or dropped a state fails here instead of
 * silently rendering an empty avatar. */

const svgOf = (el: HTMLElement) => el.querySelector("svg")!;
const bodyPath = (el: HTMLElement) =>
  svgOf(el).querySelector("mask path")!.getAttribute("d") ?? "";

describe("BloubBot", () => {
  it("draws a body for every state the engine ships", () => {
    for (const def of STATES) {
      const { container } = render(<BloubBot state={def.id} animate={false} />);
      expect(bodyPath(container), def.id).toMatch(/^M/);
      cleanup();
    }
  });

  it("gives different states different silhouettes", () => {
    const { container: a } = render(<BloubBot state="idle" animate={false} />);
    const idle = bodyPath(a);
    cleanup();
    const { container: b } = render(<BloubBot state="thinking" animate={false} />);
    expect(bodyPath(b)).not.toBe(idle);
  });

  it("paints the body in the colour it is given", () => {
    const { container } = render(<BloubBot ink="#ff0000" animate={false} />);
    expect(svgOf(container).querySelector("rect")).toHaveAttribute(
      "fill",
      "#ff0000"
    );
  });

  it("is hidden from screen readers unless it is given a name", () => {
    const { container } = render(<BloubBot animate={false} />);
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
    cleanup();
    const { container: named } = render(
      <BloubBot animate={false} label="Filey AI" />
    );
    expect(svgOf(named)).toHaveAttribute("aria-label", "Filey AI");
  });
});

describe("agent mood mapping", () => {
  const moods = [
    "idle",
    "thinking",
    "working",
    "answered",
    "error",
    "asleep",
  ] as const;

  it("maps every mood to a state and an expression the engine knows", () => {
    const known = new Set<StateId>(STATES.map((s) => s.id));
    for (const mood of moods) {
      expect(known.has(botStateFor(mood)), mood).toBe(true);
      expect(EXPRESSION_BY_ID.has(botExpressionFor(mood)), mood).toBe(true);
    }
  });

  it("shows work and failure as different faces", () => {
    expect(botStateFor("thinking")).not.toBe(botStateFor("idle"));
    expect(botStateFor("error")).not.toBe(botStateFor("answered"));
  });
});
