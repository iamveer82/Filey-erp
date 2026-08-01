import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataTable } from "../ui";

// This suite renders twice; nothing else unmounts the first tree for us.
afterEach(cleanup);

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

describe("DataTable pinned last column", () => {
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
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
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
        { key: "act", label: "Actions", render: () => "menu" },
      ]}
    />
  );

  it("pins Actions once the table is wider than its card", () => {
    const restore = fakeWidths(900, 400);
    try {
      const view = render(wide);
      expect(view.getByText("menu").closest("td")).toHaveClass("cell-pinned-end");
      expect(view.getByText("ID").closest("th")).not.toHaveClass("cell-pinned-end");
    } finally {
      restore();
    }
  });

  it("leaves the column unpinned when everything fits", () => {
    const restore = fakeWidths(400, 400);
    try {
      const view = render(wide);
      expect(view.getByText("menu").closest("td")).not.toHaveClass(
        "cell-pinned-end"
      );
    } finally {
      restore();
    }
  });
});
