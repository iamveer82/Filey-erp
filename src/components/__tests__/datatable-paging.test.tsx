import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataTable } from "../ui";

// This suite renders twice; nothing else unmounts the first tree for us.
afterEach(cleanup);

it("shows partial selection until every row is selected", () => {
  render(<DataTable rows={[{ id: 1 }, { id: 2 }]} rowKey={row => row.id}
    columns={[{ key: "id", label: "ID", render: row => row.id }]}
    bulkActions={[{ label: "Update", run: () => {} }]} />);
  const [all, first] = screen.getAllByRole("checkbox") as HTMLInputElement[];
  fireEvent.click(first);
  expect(all.indeterminate).toBe(true);
  fireEvent.click(all);
  expect(all.indeterminate).toBe(false);
  expect(all).toBeChecked();
});

const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
const table = (
  <DataTable
    rows={rows}
    pageSize={10}
    columns={[{ key: "id", label: "ID", render: (r) => `row-${r.id}` }]}
  />
);

describe("DataTable pageSize", () => {
  it("shows one page at a time and walks forward", () => {
    render(table);
    expect(screen.getByText("row-10")).toBeInTheDocument();
    expect(screen.queryByText("row-11")).not.toBeInTheDocument();
    expect(screen.getByText(/1–10 of 25/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("row-11")).toBeInTheDocument();
    expect(screen.queryByText("row-10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(/21–25 of 25/)).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("renders every row and no footer without pageSize", () => {
    const view = render(
      <DataTable
        rows={rows}
        columns={[{ key: "id", label: "ID", render: (r) => `row-${r.id}` }]}
      />
    );
    expect(view.getByText("row-25")).toBeInTheDocument();
    expect(view.queryByText("Next")).not.toBeInTheDocument();
  });
});

describe("DataTable responsive quick view", () => {
  /** jsdom has no layout, so fake the one measurement the pin depends on. */
  const fakeWidths = (scrollWidth: number, clientWidth: number) => {
    const props = ["scrollWidth", "clientWidth"] as const;
    const values = { scrollWidth, clientWidth };
    for (const p of props) {
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true,
        get: () => values[p],
      });
    }
    class RO {
      constructor(private cb: (entries: { target: Element }[]) => void) {}
      observe(target: Element) {
        this.cb([{ target }]);
      }
      disconnect() {}
      unobserve() {}
    }
    (globalThis as any).ResizeObserver = RO;
    return () => {
      for (const p of props) delete (HTMLElement.prototype as any)[p];
      delete (globalThis as any).ResizeObserver;
    };
  };

  const wide = (
    <DataTable
      rows={[{ id: 1 }]}
      columns={[
        { key: "id", label: "ID", render: (r) => `row-${r.id}` },
        { key: "act", label: "Actions", actions: true, render: () => "menu" },
      ]}
    />
  );

  it("uses quick views when content is wider than even a large container", () => {
    const restore = fakeWidths(1600, 1200);
    try {
      const view = render(wide);
      expect(view.queryByRole("table")).toBeNull();
      expect(view.getByText("menu")).toBeVisible();
      expect(view.getByText("row-1")).toBeVisible();
    } finally {
      restore();
    }
  });

  it("keeps the table when everything fits", () => {
    const restore = fakeWidths(1200, 1200);
    try {
      const view = render(wide);
      expect(view.getByRole("table")).toBeVisible();
    } finally {
      restore();
    }
  });

  it("shows a compact summary with full details, selection, sorting and actions on narrow screens", async () => {
    const restore = fakeWidths(390, 390);
    const save = vi.fn().mockResolvedValue(undefined);
    try {
      const view = render(<DataTable rows={[{ id: 1, name: "A very long customer company name", amount: 9876543.21 }]}
        rowKey={r => r.id} bulkActions={[{ label: "Update", run: () => {} }]}
        columns={[
          { key: "id", label: "Invoice", summary: true, render: r => `INV-${r.id}` },
          { key: "name", label: "Customer", summary: true, truncate: true, sortValue: r => r.name, render: r => r.name,
            editable: { value: r => r.name, onSave: save } },
          { key: "amount", label: "Total", summary: true, sortValue: r => r.amount, render: r => `AED ${r.amount}` },
          { key: "template", label: "Template", render: () => "Corporate" },
          { key: "actions", label: "Actions", actions: true, render: () => <button>Open invoice</button> },
        ]} />);
      expect(view.queryByRole("table")).toBeNull();
      expect(view.getByText("AED 9876543.21")).toBeVisible();
      expect(view.getByTitle("A very long customer company name")).toBeVisible();
      const details = view.getByText("Details").closest("details")!;
      expect(details).toHaveTextContent("Corporate");
      fireEvent.click(view.getByText("Details"));
      expect(details.open).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "A very long customer company name" }));
      const input = view.getByRole("textbox", { name: "Edit Customer" });
      fireEvent.change(input, { target: { value: "Updated customer" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await view.findByRole("button", { name: "A very long customer company name" });
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "Updated customer");
      expect(view.getByRole("button", { name: "Open invoice" })).toBeVisible();
      fireEvent.click(view.getByRole("checkbox", { name: "Select row" }));
      expect(view.getByText("1 selected")).toBeVisible();
      fireEvent.click(view.getByRole("button", { name: "Sort records" }));
      fireEvent.click(view.getByRole("menuitem", { name: "Total ↓" }));
      expect(view.getByRole("button", { name: "Sort records" })).toHaveTextContent("Total ↓");
    } finally { restore(); }
  });
});
