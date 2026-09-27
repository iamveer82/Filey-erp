import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth";
import { hasLocalPassword, verifyLocalPassword } from "../localAuth";
import Login from "../../pages/Login";

const fixture = vi.hoisted(() => ({
  user: { id: "new-owner", email: "new@example.test", identities: [{}] },
  password: "earlier abandoned signup",
  verified: false,
  published: false,
  signUp: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn(), setSession: vi.fn(),
  getSession: vi.fn(), signInWithPassword: vi.fn(),
}));
vi.mock("../supabase", () => ({
  isConfigured: true,
  createSignupClient: () => ({ auth: {
    signUp: fixture.signUp, verifyOtp: fixture.verifyOtp,
    updateUser: fixture.updateUser, getSession: fixture.getSession,
  } }),
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      setSession: fixture.setSession,
      signInWithPassword: fixture.signInWithPassword,
      signOut: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("../api", () => ({ setCacheOrg: vi.fn() }));
vi.mock("../realtime", () => ({ watchRealtimeSession: vi.fn(), stopRealtime: vi.fn() }));
vi.mock("../license", () => ({
  registerCloudDevice: async () => ({ ok: true }), entitlement: async () => ({}),
  collectPurchases: async () => false, clearEntitlementCache: vi.fn(),
}));
vi.mock("../mfa", () => ({ mfaRequired: async () => false }));

const credential = { channel: "email" as const, value: " New@example.test " };
const password = "a newly chosen forest phrase";
const session = () => ({ user: fixture.user, access_token: "test-access", refresh_token: "test-refresh" });
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear(); sessionStorage.clear(); vi.resetAllMocks();
  localStorage.setItem("filey_data_mode", "local");
  fixture.password = "earlier abandoned signup";
  fixture.verified = false; fixture.published = false;
  fixture.user = { id: "new-owner", email: "new@example.test", identities: [{}] };
  // Supabase resends confirmation for an unverified account without changing
  // the password supplied by an earlier signup attempt.
  fixture.signUp.mockResolvedValue({ data: { user: fixture.user, session: null }, error: null });
  fixture.verifyOtp.mockImplementation(async () => {
    fixture.verified = true;
    return { data: { user: fixture.user, session: session() }, error: null };
  });
  fixture.getSession.mockImplementation(async () => ({ data: { session: fixture.verified ? session() : null }, error: null }));
  fixture.updateUser.mockImplementation(async ({ password: next }) => {
    expect(fixture.verified).toBe(true);
    fixture.password = next;
    return { error: null };
  });
  fixture.setSession.mockImplementation(async () => {
    expect(fixture.password).toBe(password);
    fixture.published = true;
    return { error: null };
  });
  fixture.signInWithPassword.mockImplementation(async ({ password: supplied }) => ({
    data: supplied === fixture.password ? { user: fixture.user, session: session() } : { user: null, session: null },
    error: supplied === fixture.password ? null : new Error("Invalid login credentials"),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["local", "cloud"])("saves the chosen password only after verification in %s mode, then supports password login", async (mode) => {
  localStorage.setItem("filey_data_mode", mode);
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => {
    expect(await result.current.signUpWithPassword(credential, password)).toEqual({ needsOtp: true });
  });
  expect(fixture.signUp).toHaveBeenCalledWith({ email: "new@example.test", password });
  expect(hasLocalPassword()).toBe(false);
  expect(fixture.setSession).not.toHaveBeenCalled();
  expect(fixture.updateUser).not.toHaveBeenCalled();
  await act(async () => { await result.current.verifyOtp(credential, "123456", "signup", password); });
  expect(fixture.updateUser).toHaveBeenCalledWith({ password });
  expect(fixture.published).toBe(true);
  expect(await verifyLocalPassword("new@example.test", password)).toBe(true);
  expect(JSON.stringify(localStorage)).not.toContain(password);
  expect(JSON.stringify(sessionStorage)).not.toContain(password);
  await act(async () => {
    await result.current.signOut();
    await result.current.signInWithPassword(credential, password);
  });
  expect(fixture.signInWithPassword).toHaveBeenCalledWith({ email: "new@example.test", password });
});

it("retries a failed password save without consuming the code again or signing in early", async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => { await result.current.signUpWithPassword(credential, password); });
  fixture.updateUser.mockResolvedValueOnce({ error: { code: "unexpected_failure" } });
  await act(async () => {
    await expect(result.current.verifyOtp(credential, "123456", "signup", password)).rejects.toThrow("couldn't save your password");
  });
  expect(fixture.setSession).not.toHaveBeenCalled();
  expect(hasLocalPassword()).toBe(false);
  await act(async () => { await result.current.verifyOtp(credential, "123456", "signup", password); });
  expect(fixture.verifyOtp).toHaveBeenCalledTimes(1);
  expect(fixture.updateUser).toHaveBeenCalledTimes(2);
  expect(fixture.published).toBe(true);
});

it("does not save or cache a password after an invalid code or for a different account", async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => { await result.current.signUpWithPassword(credential, password); });
  fixture.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: new Error("Code expired") });
  await act(async () => {
    await expect(result.current.verifyOtp(credential, "123456", "signup", password)).rejects.toThrow("Code expired");
    await expect(result.current.verifyOtp({ ...credential, value: "other@example.test" }, "123456", "signup", password)).rejects.toThrow("enter your password again");
  });
  expect(fixture.updateUser).not.toHaveBeenCalled();
  expect(fixture.setSession).not.toHaveBeenCalled();
  expect(hasLocalPassword()).toBe(false);
});

it("accepts an already-saved password without treating same_password as signup failure", async () => {
  const { result } = renderHook(useAuth, { wrapper });
  fixture.password = password;
  fixture.updateUser.mockResolvedValueOnce({ error: { code: "same_password" } });
  await act(async () => {
    await result.current.signUpWithPassword(credential, password);
    await result.current.verifyOtp(credential, "123456", "signup", password);
  });
  expect(fixture.published).toBe(true);
});

it("finishes signup when confirmation is disabled, but does not claim an existing account", async () => {
  const { result } = renderHook(useAuth, { wrapper });
  fixture.signUp.mockResolvedValueOnce({ data: { user: { ...fixture.user, identities: [] }, session: null }, error: null });
  await act(async () => {
    await expect(result.current.signUpWithPassword(credential, password)).rejects.toThrow("already exists");
  });
  expect(hasLocalPassword()).toBe(false);
  expect(fixture.updateUser).not.toHaveBeenCalled();
  fixture.verified = true;
  fixture.signUp.mockResolvedValueOnce({ data: { user: fixture.user, session: session() }, error: null });
  await act(async () => {
    expect(await result.current.signUpWithPassword(credential, password)).toEqual({ needsOtp: false });
  });
  expect(fixture.published).toBe(true);
  expect(fixture.verifyOtp).not.toHaveBeenCalled();
});

it("passes the signup form's password through code verification", async () => {
  render(<Login />, { wrapper });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: credential.value.trim() } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: password } });
  fireEvent.submit(screen.getByLabelText(/^Email/).closest("form")!);
  const verify = await screen.findByRole("button", { name: "Verify" });
  const code = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  fireEvent.change(code, { target: { value: "123456" } });
  fireEvent.click(verify);
  await waitFor(() => expect(fixture.updateUser).toHaveBeenCalledWith({ password }));
  await waitFor(() => expect(fixture.published).toBe(true));
});
