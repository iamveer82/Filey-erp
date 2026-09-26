import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import FitPreview from "../FitPreview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("refits when its panel changes width without changing the exported A4 size", async () => {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(432);
  const page = render(<FitPreview baseWidth={794} zoom={100}><p>Letter</p></FitPreview>);
  const paper = () => page.container.querySelector<HTMLElement>(".invoice-print")!;
  await waitFor(() => expect(paper().parentElement).toHaveStyle({ width: "400px" }));
  width.mockReturnValue(272);
  const viewport = page.container.querySelector<HTMLElement>(".fp-box")!;
  viewport.style.padding = "8px";
  act(() => resize());
  await waitFor(() => expect(paper().parentElement).toHaveStyle({ width: "256px" }));
  expect(paper()).toHaveStyle({ width: "794px", minHeight: "1123px" });
  page.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
