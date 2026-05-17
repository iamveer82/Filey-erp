import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { statusTone, Badge, Delta } from "../ui";

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
