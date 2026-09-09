import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Login from "../../pages/Login";
import PasswordRecovery from "../PasswordRecovery";
import SecurityPanel, { ChangePasswordModal } from "../../pages/settings/SecurityPanel";
import { getLocalCredential, rememberLocalCredential } from "../../lib/localAuth";
import { requestPasswordResetEmail } from "../../lib/supabase";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUpWithPassword: vi.fn(async () => ({ needsOtp: true })),
  signInWithOtp: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(async () => ({ error: null, data: { user: { id: "test-owner" } } })),
  getUser: vi.fn(async () => ({ error: null, data: { user: { id: "test-owner", email: "owner@example.test" } } })),
  updateUser: vi.fn(async () => ({ error: null })),
  refreshMfaPending: vi.fn(async () => {}),
  mfa: { listFactors: vi.fn(async () => ({ error: null, data: { totp: [] } })) },
}));
const recovery = vi.hoisted(() => ({ auth: {
  verifyOtp: vi.fn(async () => ({ error: null, data: { user: { id: "test-owner", email: "owner@example.test" } } })),
  getUser: vi.fn(async () => ({ error: null, data: { user: { id: "test-owner", email: "owner@example.test" } } })),
  updateUser: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({ error: null, data: { currentLevel: "aal1", nextLevel: "aal1" } })),
    listFactors: vi.fn(async () => ({ error: null, data: { totp: [{ id: "factor-1", status: "verified" }] } })),
    challenge: vi.fn(async () => ({ error: null, data: { id: "challenge-1" } })),
    verify: vi.fn(async () => ({ error: null })),
  },
} }));
vi.mock("../../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../../lib/supabase", () => ({
  supabase: { auth }, cloudConfigured: true, createRecoveryClient: () => recovery,
  requestPasswordResetEmail: vi.fn(async () => {}),
}));
vi.mock("../../lib/localAuth", () => ({
  getLocalCredential: vi.fn(() => null), hasLocalCredential: () => false,
  rememberLocalCredential: vi.fn(async () => {}),
}));

beforeEach(() => {
  cleanup(); localStorage.clear(); vi.clearAllMocks();
  vi.mocked(getLocalCredential).mockReturnValue(null);
});

async function startLinkRecovery() {
  render(<PasswordRecovery initialEmail="owner@example.test" recoveryToken="recovery-hash" offline={false} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "my independent forest phrase" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "my independent forest phrase" } });
}

it("sends a Resend-backed reset request from Forgot password", async () => {
  render(<Login />);
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "owner@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(requestPasswordResetEmail).toHaveBeenCalledWith("owner@example.test"));
  expect(screen.getByText(/reset link is on its way/)).toBeTruthy();
});

it("keeps an autofilled email available when sending fails and can be retried", async () => {
  vi.mocked(requestPasswordResetEmail).mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<PasswordRecovery initialEmail="" offline={false} onBack={() => {}} />);
  const email = screen.getByLabelText(/Email/) as HTMLInputElement;
  email.value = "owner@example.test";
  fireEvent.submit(email.closest("form")!);
  await screen.findByText("Connection interrupted");
  expect(screen.queryByText(/reset link is on its way/)).toBeNull();
  fireEvent.submit(email.closest("form")!);
  await screen.findByText(/reset link is on its way/);
  expect(requestPasswordResetEmail).toHaveBeenCalledTimes(2);
  expect(requestPasswordResetEmail).toHaveBeenLastCalledWith("owner@example.test");
});

it("consumes the one-time recovery link before changing the password", async () => {
  await startLinkRecovery(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(recovery.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "recovery-hash", type: "recovery" });
  expect(recovery.auth.updateUser).toHaveBeenCalledWith({ password: "my independent forest phrase" });
  expect(recovery.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});

it("updates only the matching device credential after a Resend reset", async () => {
  vi.mocked(getLocalCredential).mockReturnValue({ email: "owner@example.test", userId: "test-owner", verifiedAt: "" });
  await startLinkRecovery(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(rememberLocalCredential).toHaveBeenCalledWith("owner@example.test", "test-owner", "my independent forest phrase");
});

it("does not change the password when the recovery link is rejected", async () => {
  recovery.auth.verifyOtp.mockResolvedValueOnce({ error: new Error("Link expired"), data: { user: null } } as never);
  await startLinkRecovery(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Link expired");
  expect(recovery.auth.updateUser).not.toHaveBeenCalled(); expect(rememberLocalCredential).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Request a new reset link" }));
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await screen.findByText(/reset link is on its way/);
  expect(requestPasswordResetEmail).toHaveBeenCalledWith("owner@example.test");
  expect(screen.queryByLabelText(/^New password/)).toBeNull();
});

it("rejects mismatched passwords without consuming the link", async () => {
  await startLinkRecovery();
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "a different forest phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Passwords do not match.");
  expect(recovery.auth.verifyOtp).not.toHaveBeenCalled();
});

it("retries a failed update without consuming the one-time link again", async () => {
  recovery.auth.updateUser.mockResolvedValueOnce({ error: new Error("Connection interrupted") } as never);
  await startLinkRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Connection interrupted");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(recovery.auth.verifyOtp).toHaveBeenCalledTimes(1);
  expect(recovery.auth.getUser).toHaveBeenCalledTimes(2);
  expect(recovery.auth.updateUser).toHaveBeenCalledTimes(2);
});

it("preserves another account's offline credential", async () => {
  vi.mocked(getLocalCredential).mockReturnValue({ email: "other@example.test", userId: "other-owner", verifiedAt: "" });
  await startLinkRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(rememberLocalCredential).not.toHaveBeenCalled();
});

it("resumes after reconnecting without losing the reset form", async () => {
  render(<PasswordRecovery initialEmail="owner@example.test" recoveryToken="recovery-hash" offline onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "my independent forest phrase" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "my independent forest phrase" } });
  expect(screen.getByRole("button", { name: "Reset password" })).toBeDisabled();
  expect(recovery.auth.verifyOtp).not.toHaveBeenCalled();
  fireEvent(window, new Event("online"));
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
});

it("stops recovery after leaving while link verification is pending", async () => {
  let complete!: (value: Awaited<ReturnType<typeof recovery.auth.verifyOtp>>) => void;
  recovery.auth.verifyOtp.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const view = render(<PasswordRecovery initialEmail="owner@example.test" recoveryToken="recovery-hash" offline={false} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "my independent forest phrase" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "my independent forest phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  view.unmount();
  complete({ error: null, data: { user: { id: "test-owner", email: "owner@example.test" } } });
  await waitFor(() => expect(recovery.auth.signOut).toHaveBeenCalledTimes(2));
  expect(recovery.auth.getUser).not.toHaveBeenCalled();
  expect(recovery.auth.updateUser).not.toHaveBeenCalled();
});

it("clears verified identity and password fields when a different link opens", async () => {
  recovery.auth.updateUser.mockResolvedValueOnce({ error: new Error("Retry the update") } as never);
  const view = render(<PasswordRecovery initialEmail="owner@example.test" recoveryToken="first-hash" offline={false} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "my independent forest phrase" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "my independent forest phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Retry the update");
  view.rerender(<PasswordRecovery initialEmail="owner@example.test" recoveryToken="second-hash" offline={false} onBack={() => {}} />);
  expect(screen.getByLabelText(/^New password/)).toHaveValue("");
  expect(screen.queryByText("Reset link verified.")).toBeNull();
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "my independent forest phrase" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: "my independent forest phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(recovery.auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: "second-hash", type: "recovery" });
});

it("validates password strength before consuming the recovery link", async () => {
  await startLinkRecovery();
  const input = screen.getByLabelText(/^New password/);
  fireEvent.change(input, { target: { value: "password" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText(/most commonly used/);
  expect(recovery.auth.verifyOtp).not.toHaveBeenCalled(); expect(recovery.auth.updateUser).not.toHaveBeenCalled();
});

it("does not reset another account when the recovery identity changes", async () => {
  recovery.auth.getUser.mockResolvedValueOnce({ error: null, data: { user: { id: "different-user", email: "owner@example.test" } } });
  await startLinkRecovery(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText(/recovery session changed/); expect(recovery.auth.updateUser).not.toHaveBeenCalled();
});

it("requires the enrolled authenticator before resetting", async () => {
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: null, data: { currentLevel: "aal1", nextLevel: "aal2" } });
  await startLinkRecovery(); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  const input = await screen.findByLabelText(/Authenticator code/); expect(recovery.auth.updateUser).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "654321" } });
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: null, data: { currentLevel: "aal1", nextLevel: "aal2" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" })); await screen.findByRole("heading", { name: "Password reset" });
  expect(recovery.auth.mfa.verify).toHaveBeenCalledWith({ factorId: "factor-1", challengeId: "challenge-1", code: "654321" });
});

it("does not save a password when the MFA check fails", async () => {
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: new Error("Unable to check verification"), data: null } as never);
  await startLinkRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Unable to check verification");
  expect(recovery.auth.updateUser).not.toHaveBeenCalled();
});

it("fails closed if the recovery session has no assurance level", async () => {
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: null, data: { currentLevel: null, nextLevel: null } } as never);
  await startLinkRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Could not check two-step verification. Try again.");
  expect(recovery.auth.updateUser).not.toHaveBeenCalled();
});

it("does not save a password for an invalid authenticator code", async () => {
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: null, data: { currentLevel: "aal1", nextLevel: "aal2" } });
  await startLinkRecovery();
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  fireEvent.change(await screen.findByLabelText(/Authenticator code/), { target: { value: "654321" } });
  recovery.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ error: null, data: { currentLevel: "aal1", nextLevel: "aal2" } });
  recovery.auth.mfa.verify.mockResolvedValueOnce({ error: new Error("Invalid authenticator code") } as never);
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByText("Invalid authenticator code");
  expect(recovery.auth.updateUser).not.toHaveBeenCalled();
  expect(rememberLocalCredential).not.toHaveBeenCalled();
});

it("accepts browser-autofilled login passwords", async () => {
  render(<Login />); const email = screen.getByLabelText(/Email/) as HTMLInputElement; const password = screen.getByLabelText(/^Password\s*\*$/) as HTMLInputElement;
  email.value = "owner@example.test"; password.value = "old123"; fireEvent.submit(password.closest("form")!);
  await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ channel: "email", value: "owner@example.test" }, "old123"));
});

it("keeps the existing signed-in email-proof password change working", async () => {
  render(<ChangePasswordModal open onClose={() => {}} />); fireEvent.click(screen.getByRole("button", { name: "Verify by email" })); fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
  await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "owner@example.test", options: { shouldCreateUser: false } }));
  fireEvent.change(await screen.findByLabelText("Email verification code"), { target: { value: "123456" } });
  for (const input of document.querySelectorAll('input[type="password"]')) fireEvent.change(input, { target: { value: "my independent forest phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Update Password" })); await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "my independent forest phrase" }));
});

it("does not report MFA as off after a failed settings check and can retry", async () => {
  auth.mfa.listFactors.mockResolvedValueOnce({ error: new Error("Connection interrupted"), data: null } as never);
  auth.mfa.listFactors.mockResolvedValueOnce({ error: null, data: { totp: [{ id: "factor-1", status: "verified", friendly_name: "My authenticator" }] } } as never);
  render(<SecurityPanel onChangePassword={() => {}} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/^Off —/)).toBeNull();
  expect(screen.getByRole("button", { name: /Two-Factor Authentication/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(/^On —/);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(auth.mfa.listFactors).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: /Two-Factor Authentication/ }));
  await screen.findByText(/My authenticator is set up/);
});
