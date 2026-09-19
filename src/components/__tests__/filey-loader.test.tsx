import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import FileyLoader from "../FileyLoader";
import { FileySpinner } from "../FileySpinner";
afterEach(cleanup);

it("announces loading once and keeps busy icons decorative without nested rotation", () => {
  const { container } = render(<><FileyLoader label="Preparing your workspace" /><button disabled><FileySpinner className="animate-spin text-foreground" size={16} />Saving invoice</button></>);
  expect(screen.getByRole("status", { name: "Preparing your workspace" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Saving invoice" })).toBeDisabled();
  expect(container.querySelector("button svg")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector(".animate-spin")).toBeNull();
});
