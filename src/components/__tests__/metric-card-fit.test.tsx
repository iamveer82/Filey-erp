import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricCard } from "../ui";

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
  let width = 300;
  Object.defineProperties(total, {
    clientWidth: { get: () => width },
    scrollWidth: { get: () => 15 * parseInt(total.style.fontSize) },
  });
  resize();
  expect(total.style.whiteSpace).toBe("nowrap");
  width = 80;
  resize();
  expect(total.style.whiteSpace).toBe("normal");
  expect(total).toHaveAttribute("title", value);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
