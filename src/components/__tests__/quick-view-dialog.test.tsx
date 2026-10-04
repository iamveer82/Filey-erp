import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickViewModal } from "../RowActions";
import { Modal } from "../ui";

afterEach(cleanup);

it("names the record dialog, traps focus and closes only the topmost nested view", async () => {
  function Page() {
    const [open, setOpen] = useState(false), [nested, setNested] = useState(false);
    return <><button onClick={() => setOpen(true)}>View invoice</button><button>Outside action</button>
      <QuickViewModal open={open} onClose={() => setOpen(false)} data={{ title: "INV-001", footer: <><button onClick={() => setNested(true)}>Related customer</button><Modal open={nested} onClose={() => setNested(false)} title="Customer"><input aria-label="Customer name" /></Modal></> }} />
    </>;
  }
  render(<Page />);
  const trigger = screen.getByRole("button", { name: "View invoice" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "INV-001" });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  act(() => screen.getByRole("button", { name: "Outside action", hidden: true }).focus());
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Related customer" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Customer name" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Customer" })).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "INV-001" })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("keeps zero values and stored line amounts visible in record details", () => {
  render(<QuickViewModal open onClose={() => {}} data={{ title: "Stock summary", meta: [{ label: "Available", value: 0 }], items: [{ desc: "Custom-priced item", qty: 2, price: 10, amount: 15 }], total: 15 }} />);
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /Amount 15.00/ })).toBeInTheDocument();
});
