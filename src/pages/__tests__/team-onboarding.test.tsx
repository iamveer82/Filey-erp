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
  avatar: vi.fn(),
  profileUpdate: vi.fn(),
  role: "owner",
  incoming: [] as unknown[],
}));
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: { id: "owner" },
    profile: { org_id: "one", name: "Owner", company: "Acme" },
    updateProfile: mocks.profileUpdate,
    reloadProfile: mocks.reload,
  }),
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({
    toast: { success: mocks.success, error: mocks.error },
    confirm: async () => true,
  }),
}));
vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  isLocalMode: () => false,
}));
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
        role: mocks.role,
      },
      { id: 2, org_id: "one", user_id: "staff", name: "Teammate", email: "staff@example.invalid", role: "staff", avatar: "/avatars/mint.svg", avatar_override: "/avatars/mint.svg" },
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
    setMemberAvatar: mocks.avatar,
    connections: async () => ({code:'A1B2C3',workspace_id:'one',workspace_name:'Acme',requests:[]}),
  },
}));
import UsersRoles from "../settings/UsersRoles";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.incoming = [];
  mocks.role = "owner";
  mocks.reload.mockResolvedValue(undefined);
  mocks.accept.mockResolvedValue(undefined);
  mocks.avatar.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
it("keeps a custom workspace avatar on failure, retries it and leaves the personal profile unchanged", async () => {
  mocks.avatar.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  render(<MemoryRouter><UsersRoles /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Change avatar for Teammate" }));
  expect(screen.getByRole("button", { name: "Organic shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mint colour" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Cloud shape" }));
  fireEvent.click(screen.getByRole("button", { name: "Rose colour" }));
  expect(mocks.avatar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save avatar" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cloud shape" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Rose colour" })).toHaveAttribute("aria-pressed", "true");
  expect(mocks.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save avatar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.avatar).toHaveBeenLastCalledWith(2, "one", "/avatars/blobatar/cloud-rose.svg");
  expect(mocks.avatar).toHaveBeenCalledTimes(2);
  expect(mocks.profileUpdate).not.toHaveBeenCalled();
});
it("discards a cancelled avatar choice and resets only the saved workspace override", async () => {
  render(<MemoryRouter><UsersRoles /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Change avatar for Teammate" }));
  fireEvent.click(screen.getByRole("button", { name: "Triangle shape" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.avatar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Change avatar for Teammate" }));
  expect(screen.getByRole("button", { name: "Organic shape" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Use profile photo or initials" }));
  expect(mocks.avatar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save avatar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.avatar).toHaveBeenCalledExactlyOnceWith(2, "one", null);
  expect(mocks.profileUpdate).not.toHaveBeenCalled();
});
it("lets staff choose their own workspace avatar but not a colleague's", async () => {
  mocks.role = "staff";
  render(<MemoryRouter><UsersRoles /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Change avatar for Owner" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change avatar for Teammate" })).not.toBeInTheDocument();
});
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
  expect(mocks.invite).toHaveBeenCalledWith('teammate@example.invalid', 'staff', ['team']);
});
