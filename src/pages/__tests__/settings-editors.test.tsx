import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import UsersRoles from "../settings/UsersRoles";
import ExpenseScanModal from "../../components/ExpenseScanModal";

const invite = vi.hoisted(() => vi.fn());
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ profile: { org_id: "org-1", name: "Owner" }, user: { id: "owner-1" }, updateProfile: vi.fn() }),
}));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../../lib/supabase", () => ({ supabase: null }));
vi.mock("../../lib/api", () => ({
  org: {
    get: async () => ({ id: "org-1", name: "Example team" }),
    members: async () => [{ id: "member-1", user_id: "owner-1", org_id: "org-1", role: "owner", name: "Owner" }],
    invites: async () => [], myInvites: async () => [], invite,
  },
  fin: { createExpense: vi.fn() },
}));
vi.mock("../../lib/ai", () => ({ aiReady: () => true, extractExpenseFromImage: async () => ({ vendor: "Office shop", amount: 20, date: "2026-09-08", category: "Office", description: "Paper" }) }));
vi.mock("../../lib/docScan", () => ({ fileToImages: async () => [] }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("retains an invitation draft after a failed send and closes only after a successful retry", async () => {
  invite.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce("invite-1");
  render(<MemoryRouter><UIProvider><UsersRoles /></UIProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Invite Member" }));
  const modal = within(screen.getByRole("dialog"));
  fireEvent.change(modal.getByLabelText("Email address"), { target: { value: "teammate@example.test" } });
  fireEvent.click(modal.getByRole("button", { name: "Send invite" }));
  await screen.findByText("Could not invite: Network unavailable");
  expect(modal.getByLabelText("Email address")).toHaveValue("teammate@example.test");
  fireEvent.click(modal.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(invite).toHaveBeenCalledTimes(2);
});

it("provides a keyboard-reachable receipt upload and names every extracted expense control", async () => {
  render(<MemoryRouter><UIProvider><ExpenseScanModal open onClose={() => {}} /></UIProvider></MemoryRouter>);
  const upload = screen.getByLabelText("Upload receipt PDF or image");
  expect(upload).not.toHaveClass("hidden");
  fireEvent.change(upload, { target: { files: [new File(["sample"], "receipt.png", { type: "image/png" })] } });
  expect(await screen.findByLabelText("Vendor")).toHaveValue("Office shop");
  expect(screen.getByLabelText("Amount")).toHaveValue("20");
  expect(screen.getByLabelText("Date")).toBeInTheDocument();
  expect(screen.getByLabelText("Category")).toBeInTheDocument();
  expect(screen.getByLabelText("Note")).toHaveValue("Paper");
});
