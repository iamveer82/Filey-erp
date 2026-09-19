import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
const fixture = vi.hoisted(() => ({
  user: { id: "owner", email: "owner@example.test" },
  signOut: vi.fn(),
  expired: false,
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  profileRead: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  scope: "previous-org:previous-user",
  onAuth: undefined as undefined | ((event: string, session: { user: { id: string; email: string } } | null) => void),
}));
vi.mock("../../lib/supabase", () => ({
  isConfigured: true,
  supabase: {
    auth: {
      getSession: fixture.getSession,
      onAuthStateChange: (callback: typeof fixture.onAuth) => { fixture.onAuth = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: fixture.signOut,
      signInWithPassword: fixture.signIn,
      signUp: fixture.signUp,
      verifyOtp: fixture.verifyOtp,
      refreshSession: fixture.refreshSession,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: fixture.profileRead,
        }),
      }),
    }),
  },
}));
vi.mock("../../lib/api", () => ({ setCacheOrg: vi.fn((org?: string | null, user?: string) => { fixture.scope = user ? `${org || "default"}:${user}` : "signed out"; }) }));
vi.mock("../../lib/realtime", () => ({ startRealtime: vi.fn(), stopRealtime: vi.fn() }));
vi.mock("../../lib/license", () => ({
  registerCloudDevice: async () => ({ ok: true }),
  entitlement: async () => ({}),
  collectPurchases: async () => false,
}));
vi.mock("../../lib/mfa", () => ({ mfaRequired: async () => false }));
import { AuthProvider, adoptLocalProfile, useAuth } from "../../lib/auth";
import { rememberLocalIdentity, setLocalSignedIn } from "../../lib/localAuth";
import * as localAuth from "../../lib/localAuth";

let currentAuth: ReturnType<typeof useAuth>;

function SessionProbe() {
  const auth = useAuth();
  currentAuth = auth;
  return (
    <div data-testid="session" data-cache-scope={fixture.scope}>
      {auth.profileError && <span>{auth.profileError}</span>}
      {auth.loading || auth.profileLoading
        ? "Loading"
        : `${auth.user?.id}:${auth.profile?.company}:${auth.needsProfile ? "setup" : "ready"}`}
    </div>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fixture.expired = false;
  fixture.scope = "previous-org:previous-user";
  fixture.onAuth = undefined;
  fixture.getSession.mockResolvedValue({ data: { session: { user: fixture.user } } });
  fixture.profileRead.mockImplementation(async () => ({ data: { ...fixture.user, name: "Owner", company: "Example", org_id: "org" }, error: fixture.expired ? { message: "JWT expired" } : null }));
  const result = { data: { user: { ...fixture.user, identities: [{}] }, session: { user: fixture.user } }, error: null };
  fixture.signIn.mockResolvedValue(result);
  fixture.signUp.mockResolvedValue(result);
  fixture.verifyOtp.mockResolvedValue(result);
  fixture.signOut.mockResolvedValue({ error: null });
  // Password hashing has separate coverage; this suite tests identity timing.
  vi.spyOn(localAuth, "rememberLocalCredential").mockImplementation(async (email, userId) => { rememberLocalIdentity(email, userId); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("restores the real AuthProvider in local, cloud and local again without signing out or repeating setup", async () => {
  localStorage.clear();
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  adoptLocalProfile({ ...fixture.user, name: "Owner", company: "Example", org_id: "org" });
  setLocalSignedIn(true);
  for (const mode of ["local", "cloud", "local"]) {
    localStorage.setItem("filey_data_mode", mode);
    const page = render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>
    );
    if (mode === "local") expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "org:owner");
    else expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
    await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
    expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "org:owner");
    page.unmount();
  }
  expect(fixture.signOut).not.toHaveBeenCalled();
});

it.each(["password", "otp", "signup", "offline password"])("sets the local scope before publishing a successful %s sign-in", async (method) => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  adoptLocalProfile({ ...fixture.user, name: "Owner", company: "Example", org_id: "org" });
  setLocalSignedIn(false);
  if (method === "offline password") {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(localAuth, "hasLocalPassword").mockReturnValue(true);
    vi.spyOn(localAuth, "verifyLocalPassword").mockResolvedValue(true);
  }
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
  const credential = { channel: "email" as const, value: fixture.user.email };
  await act(async () => {
    if (method === "otp") await currentAuth.verifyOtp(credential, "123456", "login");
    else if (method === "signup") await currentAuth.signUpWithPassword(credential, "test-password");
    else await currentAuth.signInWithPassword(credential, "test-password");
  });
  expect(screen.getByText("owner:Example:ready")).toBeTruthy();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "org:owner");
  await act(async () => { await currentAuth.signOut(); });
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
});

it("updates local profile scope before rendering its new company details", async () => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  setLocalSignedIn(true);
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => { await currentAuth.updateProfile({ org_id: "updated-org", company: "Updated" }); });
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "updated-org:owner");
  await act(async () => { await currentAuth.createProfile("Owner", "Name", "Created"); });
  expect(screen.getByText("owner:Created:ready")).toBeTruthy();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "updated-org:owner");
});

it("uses the restored cloud user scope while its profile is pending and cannot revive it after sign-out", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  let resolveProfile!: (value: unknown) => void;
  fixture.profileRead.mockImplementation(() => new Promise((resolve) => { resolveProfile = resolve; }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
  await waitFor(() => expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "default:owner"));
  await act(async () => { fixture.onAuth?.("SIGNED_OUT", null); });
  await act(async () => { resolveProfile({ data: { ...fixture.user, name: "Owner", company: "Example", org_id: "org" }, error: null }); });
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
  expect(currentAuth.user).toBeNull();
});

it("ignores a restored session that arrives after a newer sign-out event", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  let resolveSession!: (value: unknown) => void;
  fixture.getSession.mockImplementation(() => new Promise((resolve) => { resolveSession = resolve; }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => { fixture.onAuth?.("SIGNED_OUT", null); });
  await act(async () => { resolveSession({ data: { session: { user: fixture.user } } }); });
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
  expect(currentAuth.user).toBeNull();
  expect(fixture.profileRead).not.toHaveBeenCalled();
});


it("recovers an expired cloud JWT before loading the existing profile", async () => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  fixture.expired = true;
  fixture.refreshSession.mockImplementation(async () => {
    fixture.expired = false;
    return { data: { session: { user: fixture.user } }, error: null };
  });
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
  expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
  expect(fixture.signOut).not.toHaveBeenCalled();
});


it("stops after one refresh when the server still rejects the JWT", async () => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  fixture.expired = true;
  fixture.refreshSession.mockClear();
  fixture.refreshSession.mockResolvedValue({
    data: { session: { user: fixture.user } }, error: null,
  });
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("JWT expired")).toBeTruthy());
  expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/:setup$/)).toBeNull();
  fixture.expired = false;
});
