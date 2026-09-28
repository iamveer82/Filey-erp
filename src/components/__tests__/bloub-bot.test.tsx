import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import BloubBot from "../BloubBot";
import { setPersona, getPersona } from "../../lib/ai";
import { BOT_LOOKS } from "../../lib/botAppearance";
import { botExpressionFor, botStateFor } from "../../lib/botMood";
import { STATES, type StateId } from "../../lib/bloub/states";
import { EXPRESSION_BY_ID } from "../../lib/bloub/expressions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => localStorage.clear());

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

  it("keeps the white look visible on a light surface", () => {
    const { container } = render(<BloubBot ink="#FFFFFF" animate={false} />);
    expect(container.querySelector('path[stroke="#d4d4d8"]')).not.toBeNull();
    expect(container.querySelector('g[opacity] > path')?.getAttribute("fill")).toBe("#0a0a0a");
  });

  it("follows the colour chosen in settings, without a remount", () => {
    const { container } = render(<BloubBot animate={false} />);
    const rect = () => container.querySelector("rect")!.getAttribute("fill");
    expect(rect()).toBe("#FFD600"); // persona default

    act(() => {
      setPersona({ orbColor: "#2CADF6" });
    });
    expect(rect()).toBe("#2CADF6");
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

  it("updates every mounted avatar when a new look is selected and preserves explicit previews", () => {
    const live = render(<BloubBot animate={false} />);
    const preview = render(<BloubBot shape="cercle" animate={false} />);
    const orb = bodyPath(live.container);
    act(() => { setPersona({ botShape: "nuage" }); });
    expect(bodyPath(live.container)).not.toBe(orb);
    expect(bodyPath(preview.container)).toBe(orb);
    for (const look of BOT_LOOKS) {
      live.rerender(<BloubBot shape={look.id} animate={false} />);
      expect(bodyPath(live.container), look.name).not.toMatch(/NaN|Infinity/);
    }
  });

  it("saves safe appearance preferences and ignores unknown or broken stored choices", () => {
    setPersona({ botShape: "goutte", botMotion: "still" });
    expect(getPersona()).toMatchObject({ botShape: "goutte", botMotion: "still" });
    setPersona({ botShape: "missing", botMotion: "missing", orbColor: "invalid" } as never);
    expect(getPersona()).toMatchObject({ botShape: "cercle", botMotion: "playful", orbColor: "#FFD600" });
  });

  it("adds continuous orbit rings without replacing the selected shape or a work state", () => {
    const { container, rerender } = render(<BloubBot shape="nuage" motion="gentle" animate={false} />);
    const cloud = bodyPath(container);
    rerender(<BloubBot shape="nuage" motion="orbit" animate={false} />);
    expect(bodyPath(container)).toBe(cloud);
    expect(container.querySelectorAll("linearGradient")).toHaveLength(3);
    rerender(<BloubBot state="thinking" shape="nuage" motion="orbit" animate={false} />);
    expect(container.querySelectorAll("linearGradient")).toHaveLength(0);
  });

  it("starts no animation loops in Still mode or with reduced motion and reacts to preference changes", () => {
    let reduced = false;
    const query = new EventTarget();
    Object.defineProperty(query, "matches", { get: () => reduced });
    vi.stubGlobal("matchMedia", () => query);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { rerender } = render(<BloubBot motion="still" ambient />);
    expect(raf).not.toHaveBeenCalled();
    reduced = true;
    rerender(<BloubBot motion="playful" ambient />);
    expect(raf).not.toHaveBeenCalled();
    act(() => { reduced = false; query.dispatchEvent(new Event("change")); });
    expect(raf).toHaveBeenCalled();
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    act(() => { reduced = true; query.dispatchEvent(new Event("change")); });
    expect(cancel).toHaveBeenCalled();
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
