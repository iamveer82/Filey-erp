import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { statusTone, Badge, Delta, FormField, SearchInput } from "../ui";

afterEach(cleanup);

it("keeps search focus after clearing and handles Escape before the enclosing dialog", () => {
  const escape = vi.fn();
  function Example() {
    const [value, setValue] = useState("invoice");
    return <div onKeyDown={escape}><SearchInput value={value} onChange={setValue} placeholder="Search records" /></div>;
  }
  render(<Example />);
  const input = screen.getByRole("textbox", { name: "Search records" });
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "customer" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
  expect(escape).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(escape).toHaveBeenCalledOnce();
});

it("links field hints and errors without losing an existing description", () => {
  const { rerender } = render(<><p id="context">Billing contact.</p><FormField label="Email" htmlFor="email" hint="Use a work email."><input id="email" aria-describedby="context" /></FormField></>);
  const input = screen.getByRole("textbox", { name: "Email" });
  expect(input).toHaveAccessibleDescription("Billing contact. Use a work email.");
  rerender(<><p id="context">Billing contact.</p><FormField label="Email" htmlFor="email" error="Check this email."><input id="email" aria-describedby="context" /></FormField></>);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("Billing contact. Check this email.");
  expect(screen.getByRole("alert")).toHaveTextContent("Check this email.");
  rerender(<><p id="context">Billing contact.</p><FormField label="Email" htmlFor="email"><input id="email" aria-describedby="context" /></FormField></>);
  expect(input).not.toHaveAttribute("aria-invalid");
  expect(input).toHaveAccessibleDescription("Billing contact.");
});

describe("statusTone", () => {
  it("maps positive states to success", () => {
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("Active")).toBe("success");
    expect(statusTone("in stock")).toBe("success");
  });
  it("maps warning / danger states", () => {
    expect(statusTone("pending")).toBe("warn");
    expect(statusTone("low stock")).toBe("warn");
    expect(statusTone("overdue")).toBe("danger");
    expect(statusTone("out of stock")).toBe("danger");
  });
  it("falls back to info for unknown", () => {
    expect(statusTone("whatever")).toBe("info");
  });
});

describe("Badge & Delta", () => {
  it("renders badge text", () => {
    render(<Badge tone="success">Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
  it("Delta shows the percentage and suffix", () => {
    render(<Delta value={12.5} />);
    expect(screen.getByText(/12\.5/)).toBeInTheDocument();
    expect(screen.getByText(/vs last month/i)).toBeInTheDocument();
  });
});
