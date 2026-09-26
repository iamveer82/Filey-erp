import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { aed, todayYmd } from "../../lib/format";
import { fin, type Expense } from "../../lib/api";
import Purchase from "../Purchase";

vi.mock("../../lib/api", () => ({ fin: { expenses: vi.fn() } }));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
afterEach(cleanup);

it("counts every expense category while showing only the six largest in the breakdown", async () => {
  const month = todayYmd().slice(0, 7);
  vi.mocked(fin.expenses).mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({
    id: i + 1, category: `Category ${i + 1}`, description: `Expense ${i + 1}`,
    amount: (i + 1) * 10, expense_date: `${month}-01`,
  } as Expense)));
  render(<MemoryRouter><UIProvider><Purchase /></UIProvider></MemoryRouter>);
  await screen.findByText("Expense 8");
  expect(within(screen.getByText("Categories").parentElement!).getByText("8")).toBeInTheDocument();
  expect(within(screen.getByText("This month").parentElement!).getByText(aed(360).replace(/\s/g, " "))).toBeInTheDocument();
  const chart = within(screen.getByText("By category").parentElement!);
  expect(chart.getAllByText(/^Category /)).toHaveLength(6);
  expect(chart.queryByText("Category 1")).toBeNull();
});
