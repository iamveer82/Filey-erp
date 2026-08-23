import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

// Hoisted: vi.mock factories run before module-level consts exist.
const { create, rows } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
  rows: [
    {
      id: 1,
      title: "Call the customer",
      due_date: "2026-01-01",
      done: false,
      customer_id: 7,
      supplier_id: null,
      created_at: "",
    },
    {
      id: 2,
      title: "Chase the supplier",
      due_date: "2026-01-01",
      done: false,
      customer_id: null,
      supplier_id: 3,
      created_at: "",
    },
    {
      id: 3,
      title: "Unlinked reminder",
      due_date: "2026-01-01",
      done: false,
      created_at: "",
    },
  ],
}));

vi.mock("../../lib/api", () => ({
  followups: {
    list: () => Promise.resolve(rows),
    create,
    update: vi.fn(),
    remove: vi.fn(),
    complete: vi.fn(),
  },
  nextFollowUpDate: () => "2026-01-02",
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({
    toast: { success: vi.fn(), error: vi.fn() },
    confirm: vi.fn().mockResolvedValue(true),
  }),
}));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../DatePicker", () => ({
  DateField: ({ value }: { value: string }) => <input readOnly value={value} />,
}));

import FollowUps from "../FollowUps";

afterEach(() => {
  cleanup();
  create.mockClear();
});

describe("FollowUps party split", () => {
  it("shows supplier rows on the supplier board only", async () => {
    render(<FollowUps party="supplier" parties={[{ id: 3, name: "ACME" }]} />);
    expect(await screen.findByText("Chase the supplier")).toBeInTheDocument();
    expect(screen.queryByText("Call the customer")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlinked reminder")).not.toBeInTheDocument();
  });

  it("keeps customer and unlinked rows on the customer board", async () => {
    render(<FollowUps party="customer" parties={[{ id: 7, name: "Rennox" }]} />);
    expect(await screen.findByText("Call the customer")).toBeInTheDocument();
    expect(screen.getByText("Unlinked reminder")).toBeInTheDocument();
    expect(screen.queryByText("Chase the supplier")).not.toBeInTheDocument();
  });

  it("writes supplier_id, not customer_id, from the supplier board", async () => {
    render(<FollowUps party="supplier" parties={[{ id: 3, name: "ACME" }]} />);
    await screen.findByText("Chase the supplier");

    fireEvent.change(screen.getByPlaceholderText(/Ask Mr Sharma/), {
      target: { value: "Ask about the delayed drum order" },
    });
    // The party picker is now a SelectMenu: open it, then pick the row.
    fireEvent.click(screen.getByLabelText("Supplier"));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("menu")).getByText("ACME"));
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      title: "Ask about the delayed drum order",
      supplier_id: 3,
      customer_id: null,
      customer_name: "ACME",
    });
  });
});
