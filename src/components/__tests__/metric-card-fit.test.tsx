import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MetricCard } from "../ui";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("refits a total when its card narrows and wraps values that cannot fit", () => {
  let resize: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const value = "AED 123,456,789,012,345.67";
  const view = render(<MetricCard label="Sales" value={value} />);
  const total = screen.getByText(value);
  let width = 420;
  Object.defineProperties(total, {
    clientWidth: { get: () => width },
    scrollWidth: { get: () => 15 * parseInt(total.style.fontSize) },
  });
  resize();
  expect(total.style.fontSize).toBe("26px");
  expect(total.style.whiteSpace).toBe("nowrap");
  width = 300;
  resize();
  expect(total.style.fontSize).toBe("20px");
  expect(total.style.whiteSpace).toBe("nowrap");
  width = 80;
  resize();
  expect(total.style.fontSize).toBe("12px");
  expect(total.style.whiteSpace).toBe("normal");
  expect(total).toHaveAttribute("title", value);
  width = 420;
  resize();
  expect(total.style.fontSize).toBe("26px");
  expect(total.style.whiteSpace).toBe("nowrap");
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
