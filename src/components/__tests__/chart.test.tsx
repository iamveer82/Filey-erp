import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "../ui/chart";

vi.mock("recharts", async (original) => ({
  ...await original<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
}));
afterEach(cleanup);

it("keeps series labels, zero currency values and legend fallbacks visible", () => {
  render(
    <ChartContainer config={{ paid: { label: "Paid invoices", color: "#18181b" } }}>
      <div>
        <ChartTooltipContent active label="September 2026" valueFormatter={value => `$${Number(value).toFixed(2)}`}
          payload={[{ graphicalItemId: "paid", dataKey: "paid", name: "paid", value: 0, color: "#18181b" }, { graphicalItemId: "open", dataKey: "open", name: "Open invoices", value: 1250.25, color: "#facc15" }]} />
        <ChartLegendContent payload={[{ dataKey: "received", value: "Receipt documents", color: "#18181b", type: "square" }]} />
      </div>
    </ChartContainer>
  );
  expect(screen.getByText("September 2026")).toBeInTheDocument();
  expect(screen.getByText("Paid invoices")).toBeInTheDocument();
  expect(screen.getByText("Open invoices")).toBeInTheDocument();
  expect(screen.getByText("$0.00")).toBeInTheDocument();
  expect(screen.getByText("$1250.25")).toBeInTheDocument();
  expect(screen.getByText("Receipt documents")).toBeInTheDocument();
});
