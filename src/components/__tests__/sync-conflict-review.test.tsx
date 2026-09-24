import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SyncConflictReview from "../SyncConflictReview";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), list: vi.fn() }));
vi.mock("../../lib/sync", () => ({
  getSyncStatus: () => ({ state: "idle" }),
  listSyncConflicts: mocks.list,
  resolveSyncConflicts: mocks.resolve,
}));
beforeEach(() => {
  mocks.list.mockResolvedValue([{ id: "invoice_docs:8", table: "invoice_docs", recordId: 8 }]);
  mocks.resolve.mockReset().mockImplementation(async () => { mocks.list.mockResolvedValue([]); return true; });
});
for (const local of [true, false]) {
  it(`offers one ${local ? "device" : "cloud"} choice without technical details or individual reviews`, async () => {
    render(<SyncConflictReview />);
    const button = await screen.findByRole("button", { name: local ? "Use this device's changes" : "Use cloud changes" });
    expect(screen.queryByText(/invoice_docs|conflicts to review/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(local));
    await waitFor(() => expect(screen.queryByText("Which changes should Filey keep?")).not.toBeInTheDocument());
  });
}
it("keeps the choice available after a failure without exposing internal errors", async () => {
  mocks.resolve.mockRejectedValue(new Error("private table SQL details"));
  render(<SyncConflictReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Use cloud changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your saved data is safe");
  expect(screen.queryByText(/SQL/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use cloud changes" })).toBeEnabled();
});
