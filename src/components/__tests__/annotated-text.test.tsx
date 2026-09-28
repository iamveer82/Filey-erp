import { cleanup, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AnnotatedText } from "../AnnotatedText";

it("draws once on entry, keeps text accessible, and cancels for reduced motion or unmount", () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  const animation = { pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
  const animate = vi.fn(() => animation);
  const disconnect = vi.fn();
  let intersect!: IntersectionObserverCallback;
  let preferenceChanged!: () => void;
  const reduced = {
    matches: true,
    addEventListener: vi.fn((_event, listener) => { preferenceChanged = listener; }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });
  vi.stubGlobal("matchMedia", () => reduced);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
  try {
    const view = render(<h2>Let's <AnnotatedText>work on it</AnnotatedText></h2>);
    expect(screen.getByRole("heading", { name: "Let's work on it" })).toBeVisible();
    expect(view.container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(animate).not.toHaveBeenCalled();

    reduced.matches = false;
    view.rerender(<AnnotatedText variant="wavy" animate={false}>work on it</AnnotatedText>);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<AnnotatedText variant="wavy">work on it</AnnotatedText>);
    expect(animate).toHaveBeenCalledOnce();
    expect(animation.pause).toHaveBeenCalledOnce();
    intersect([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(animation.play).not.toHaveBeenCalled();
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(animation.play).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
    reduced.matches = true;
    preferenceChanged();
    expect(animation.cancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(animation.cancel).toHaveBeenCalledTimes(2);
    expect(reduced.removeEventListener).toHaveBeenCalledWith("change", preferenceChanged);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(Element.prototype, "animate", original);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
});
