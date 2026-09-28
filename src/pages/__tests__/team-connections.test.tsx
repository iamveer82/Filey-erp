import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TeamConnections from "../settings/TeamConnections";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  join: vi.fn(),
  link: vi.fn(),
  review: vi.fn(),
  cancel: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  changed: vi.fn(),
  switch: vi.fn(),
  invite: vi.fn(),
  copy: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  org: {
    connections: mocks.load,
    requestJoin: mocks.join,
    linkCode: mocks.link,
    reviewJoin: mocks.review,
    cancelJoin: mocks.cancel,
  },
}));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({
    toast: { success: mocks.success, error: mocks.error },
    confirm: mocks.confirm,
  }),
}));
vi.mock("../../lib/realtime", () => ({ useLiveSync: vi.fn() }));
const base = { code: "A1B2C3", workspace_id: "one", workspace_name: "Acme", requests: [] };
function mount(canInvite = true) {
  return render(
    <TeamConnections
      orgId="one"
      canInvite={canInvite}
      onInvite={mocks.invite}
      onSwitch={mocks.switch}
      onChanged={mocks.changed}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(base);
  mocks.confirm.mockResolvedValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
});
afterEach(cleanup);
it("requires an explicit workspace link before copying a code and retains the stable account code", async () => {
  mocks.load.mockResolvedValue({ ...base, workspace_id: "two", workspace_name: "Other" });
  mount();
  expect(await screen.findByLabelText("Your invitation code")).toHaveValue("A1B2C3");
  expect(screen.getByRole("button", { name: "Copy code" })).toBeDisabled();
  mocks.link.mockImplementation(async () => {
    mocks.load.mockResolvedValue(base);
  });
  fireEvent.click(screen.getByRole("button", { name: "Link this workspace" }));
  await waitFor(() => expect(mocks.link).toHaveBeenCalledWith("one"));
  expect(mocks.confirm).toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy code" })).toBeEnabled()
  );
  mocks.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  mocks.success.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Clipboard unavailable"));
  expect(mocks.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("Invitation code copied.")
  );
  expect(mocks.copy).toHaveBeenLastCalledWith("A1B2C3");
});
it("normalizes code input, retains failed requests for retry and never switches before approval", async () => {
  mocks.join
    .mockRejectedValueOnce(new Error("Too many attempts."))
    .mockResolvedValueOnce(undefined);
  mount(false);
  fireEvent.change(screen.getByLabelText("Invitation code"), {
    target: { value: "a1-b2c3" },
  });
  expect(screen.getByLabelText("Invitation code")).toHaveValue("A1B2C3");
  fireEvent.click(screen.getByRole("button", { name: "Request to join" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Too many attempts."));
  expect(screen.getByLabelText("Invitation code")).toHaveValue("A1B2C3");
  fireEvent.click(screen.getByRole("button", { name: "Request to join" }));
  await waitFor(() => expect(screen.getByLabelText("Invitation code")).toHaveValue(""));
  expect(mocks.join).toHaveBeenLastCalledWith("A1B2C3");
  expect(mocks.switch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Copy code" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Invite by email" })).toBeDisabled();
});
it("approves the exact request with least privilege and preserves the review on failure", async () => {
  mocks.load.mockResolvedValue({
    ...base,
    requests: [
      {
        id: "request",
        org_id: "one",
        workspace_name: "Acme",
        incoming: true,
        name: "Sam",
        email: "sam@example.invalid",
        status: "pending",
      },
    ],
  });
  mocks.review
    .mockRejectedValueOnce(new Error("Try again"))
    .mockResolvedValueOnce(undefined);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Review request" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve member" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve member" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.review).toHaveBeenLastCalledWith("request", "one", true, "staff", [
    "team",
  ]);
  expect(mocks.changed).toHaveBeenCalledOnce();
});
it("lets approved applicants choose when to open their workspace", async () => {
  mocks.load.mockResolvedValue({
    ...base,
    requests: [
      {
        id: "request",
        org_id: "two",
        workspace_name: "Other",
        incoming: false,
        status: "approved",
      },
    ],
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Open workspace" }));
  await waitFor(() => expect(mocks.switch).toHaveBeenCalledWith("two"));
});
