import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataTable, keyActivate } from "../ui";

afterEach(cleanup);

const rows = [{ id: 1 }, { id: 2 }];

describe("DataTable keyboard row activation", () => {
  it("opens a row on Enter and Space, and only when clickable", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        onRowClick={onRowClick}
        columns={[{ key: "id", label: "ID", render: (r) => `row-${r.id}` }]}
      />
    );
    const row = screen.getByText("row-1").closest("tr")!;
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(2);

    // Any other key is none of our business.
    fireEvent.keyDown(row, { key: "a" });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("leaves rows out of the tab order when they are not clickable", () => {
    render(
      <DataTable
        rows={rows}
        columns={[{ key: "id", label: "ID", render: (r) => `row-${r.id}` }]}
      />
    );
    expect(screen.getByText("row-1").closest("tr")).not.toHaveAttribute("tabindex");
  });

  it("ignores Enter that a nested control already handled", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        onRowClick={onRowClick}
        columns={[
          { key: "id", label: "ID", render: () => <button>Delete</button> },
        ]}
      />
    );
    fireEvent.keyDown(screen.getAllByText("Delete")[0], { key: "Enter" });
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("keyActivate", () => {
  it("fires for a control nested inside another button", () => {
    const inner = vi.fn();
    const outer = vi.fn();
    render(
      <button onClick={outer}>
        Tile
        <span role="button" tabIndex={0} onKeyDown={keyActivate(inner)}>
          Remove
        </span>
      </button>
    );
    fireEvent.keyDown(screen.getByText("Remove"), { key: "Enter" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
