import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  switch: vi.fn(),
  accept: vi.fn(),
  invite: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  incoming: [] as unknown[],
}));
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { id: "owner" },
    profile: { org_id: "one", name: "Owner", company: "Acme" },
    updateProfile: vi.fn(),
    reloadProfile: mocks.reload,
  }),
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({
    toast: { success: mocks.success, error: mocks.error },
    confirm: async () => true,
  }),
}));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../../lib/license", () => ({ clearEntitlementCache: vi.fn() }));
vi.mock("../../lib/api", () => ({
  org: {
    get: async () => ({ id: "one", name: "Acme" }),
    members: async () => [
      {
        id: 1,
        org_id: "one",
        user_id: "owner",
        name: "Owner",
        email: "owner@example.invalid",
        role: "owner",
      },
    ],
    invites: async () => [],
    myInvites: async () => mocks.incoming,
    workspaces: async () => [
      { id: "one", name: "Acme", role: "owner" },
      { id: "two", name: "Other", role: "staff" },
    ],
    switchWorkspace: mocks.switch,
    acceptInvite: mocks.accept,
    invite: mocks.invite,
  },
}));
import UsersRoles from "../settings/UsersRoles";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.incoming = [];
  mocks.reload.mockResolvedValue(undefined);
  mocks.accept.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("accepts an invitation then refreshes workspace identity and tells other tabs", async () => {
  mocks.incoming = [
    {
      id: "invite",
      role: "staff",
      workspace_name: "Sales team",
      expires_at: "2030-01-01",
    },
  ];
  render(
    <MemoryRouter initialEntries={["/settings?section=users&invite=invite"]}>
      <UsersRoles />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
  await waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
  expect(mocks.accept).toHaveBeenCalledWith("invite");
  expect(localStorage.getItem("filey_cloud_workspace")).toMatch(/^owner:/);
});
it("never claims an unconfirmed email was sent", async () => {
  mocks.invite.mockResolvedValue({
    id: "pending",
    status: "unknown",
    error: "Email could not be confirmed",
  });
  render(
    <MemoryRouter>
      <UsersRoles />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole("button", { name: "Invite Member" }));
  fireEvent.change(screen.getByPlaceholderText("teammate@company.com"), {
    target: { value: "teammate@example.invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith("Email could not be confirmed")
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
