import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SyncConflictReview from "../SyncConflictReview";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../lib/sync", () => ({
  listSyncConflicts: async () => [{ id: "invoice_docs:8", table: "invoice_docs", recordId: 8 }],
  reviewSyncConflict: async () => ({ local: { id: 8, number: "INV-8" }, cloud: null }),
  resolveSyncConflict: mocks.resolve,
}));

it("does not offer to replace a legacy local invoice with an unavailable cloud record", async () => {
  render(<SyncConflictReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  expect(await screen.findByText(/cloud record is unavailable/i)).toBeInTheDocument();
  expect(screen.getByText(/no saved cloud revision/i)).toBeInTheDocument();
  const useCloud = screen.getByRole("button", { name: "Use cloud version" });
  expect(useCloud).toBeDisabled();
  fireEvent.click(useCloud);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
