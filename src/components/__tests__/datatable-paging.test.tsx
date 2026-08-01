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
