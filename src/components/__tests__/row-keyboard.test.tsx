import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataTable, keyActivate } from "../ui";
import { shareVia } from "../RowActions";

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

it("keeps a copy request pending until the clipboard confirms and rejects unavailable clipboard access", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let confirm!: () => void;
  const write = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
  try {
    let finished = false;
    const pending = shareVia("copyLink", { url: "https://example.test/document" }).then(() => { finished = true; });
    await Promise.resolve();
    expect(write).toHaveBeenCalledExactlyOnceWith("https://example.test/document");
    expect(finished).toBe(false);
    confirm(); await pending;
    expect(finished).toBe(true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(shareVia("copyLink", {})).rejects.toThrow("Clipboard is unavailable");
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
