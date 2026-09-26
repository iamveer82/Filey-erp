import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ESignStudio from "../ESignStudio";
import { UIProvider } from "../../lib/ui";

afterEach(cleanup);
it("shows the current pen width and names the drawing controls", () => {
  const page = render(<UIProvider><ESignStudio /></UIProvider>);
  expect(page.getByRole("button", { name: "Signature line width" })).toHaveTextContent("Medium");
  expect(page.getByRole("button", { name: "Draw signature" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(page.getByRole("button", { name: "Erase signature" }));
  expect(page.getByRole("button", { name: "Erase signature" })).toHaveAttribute("aria-pressed", "true");
  expect(page.getByLabelText("Signature colour")).toBeDisabled();
});
