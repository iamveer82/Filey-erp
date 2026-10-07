import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const fixture = vi.hoisted(() => ({
  user: { id: "owner", email: "owner@example.test" },
  signOut: vi.fn(),
  assurance: vi.fn(),
  expired: false,
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  profileRead: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(async () => ({ error: null })),
  entitlement: vi.fn(async () => ({})),
  setSession: vi.fn(async () => ({ error: null })),
  scope: "previous-org:previous-user",
  onAuth: undefined as undefined | ((event: string, session: { user: { id: string; email: string } } | null) => void),
}));
vi.mock("../../lib/supabase", () => ({
  isConfigured: true,
  createSignupClient: () => ({ auth: {
    signUp: fixture.signUp, verifyOtp: fixture.verifyOtp,
    updateUser: fixture.updateUser, getSession: fixture.getSession,
  } }),
  supabase: {
    auth: {
      setSession: fixture.setSession,
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
vi.mock("../../lib/api", () => ({
  getCacheScope: () => fixture.scope === "signed out" ? null : fixture.scope,
  setCacheOrg: vi.fn((org?: string | null, user?: string) => { fixture.scope = user ? `${org || "default"}:${user}` : "signed out"; }),
}));
vi.mock("../../lib/realtime", () => ({ watchRealtimeSession: vi.fn(), stopRealtime: vi.fn() }));
vi.mock("../../lib/license", () => ({
  registerCloudDevice: async () => ({ ok: true }),
  checkCloudDeviceLogout: async () => {},
  entitlement: fixture.entitlement,
  collectPurchases: async () => false,
  clearEntitlementCache: vi.fn(),
}));
vi.mock("../../lib/mfa", () => ({ mfaRequired: fixture.assurance }));
import { AuthProvider, adoptLocalProfile, useAuth } from "../../lib/auth";
import { rememberLocalIdentity, setLocalSignedIn } from "../../lib/localAuth";
import * as localAuth from "../../lib/localAuth";

let currentAuth: ReturnType<typeof useAuth>;

it("replaces the workspace identity after the server reports an organization switch", async () => {
  localStorage.setItem("filey_data_mode","cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
  fixture.profileRead.mockResolvedValue({data:{...fixture.user,name:"Owner",company:"Joined team",org_id:"joined-org"},error:null});
  await act(async () => { window.dispatchEvent(new CustomEvent("filey:cloud-profile",{detail:{id:"owner",org_id:"joined-org"}})); });
  await waitFor(() => expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope","joined-org:owner"));
  expect(fixture.signOut).not.toHaveBeenCalled();
});

it.each([null, { message: "JWT expired" }])("ignores an earlier profile response (%j) after a newer workspace has loaded", async (error) => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
  let finishEarlier!: (value: unknown) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise(resolve => { finishEarlier = resolve; }));
  let earlier!: Promise<void>;
  act(() => { earlier = currentAuth.reloadProfile(); });
  fixture.profileRead.mockResolvedValueOnce({ data: { ...fixture.user, company: "Joined team", org_id: "joined-org" }, error: null });
  await act(async () => { await currentAuth.reloadProfile(); });
  await act(async () => {
    finishEarlier({ data: { ...fixture.user, company: "Earlier team", org_id: "earlier-org" }, error });
    await earlier;
  });
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "joined-org:owner");
  expect(screen.getByText("owner:Joined team:ready")).toBeTruthy();
  expect(fixture.refreshSession).not.toHaveBeenCalled();
});

it("catches up on a workspace switch missed during disconnection without resetting the current screen while loading", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
  const reads = fixture.profileRead.mock.calls.length;
  act(() => window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables: ["org_messages"] } })));
  expect(fixture.profileRead).toHaveBeenCalledTimes(reads);
  let finish!: (value: unknown) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  expect(screen.getByText("owner:Example:ready")).toBeTruthy();
  await act(async () => finish({ data: { ...fixture.user, company: "Joined team", org_id: "joined-org" }, error: null }));
  expect(screen.getByText("owner:Joined team:ready")).toBeTruthy();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "joined-org:owner");
});

it.each(["focus", "online", "membership"])("recovers a removed member's personal workspace after a missed profile event on %s", async event => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("owner:Example:ready")).toBeTruthy());
  let finish!: (value: unknown) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const draft = screen.getByLabelText("Retained workspace draft");
  fireEvent.change(draft, { target: { value: "Current team draft" } });
  act(() => window.dispatchEvent(event === "membership"
    ? new CustomEvent("filey:cloud-change", { detail: { tables: ["org_members"] } })
    : new Event(event)));
  expect(draft).toHaveValue("Current team draft");
  await act(async () => finish({ data: { ...fixture.user, name: "Owner", company: "My workspace", org_id: "personal-org" }, error: null }));
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "personal-org:owner");
  expect(screen.getByText("owner:My workspace:ready")).toBeTruthy();
  expect(screen.getByLabelText("Retained workspace draft")).not.toBe(draft);
  expect(screen.getByLabelText("Retained workspace draft")).toHaveValue("");
  expect(fixture.signOut).not.toHaveBeenCalled();
});

it.each(["focus", "online"])("preserves a same-workspace draft after a transport-only %s profile refresh failure", async event => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  const draft = screen.getByLabelText("Retained workspace draft");
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  fixture.profileRead.mockResolvedValueOnce({ data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
  act(() => window.dispatchEvent(new Event(event)));
  await screen.findByRole("status");
  expect(screen.getByLabelText("Retained workspace draft")).toBe(draft);
  expect(draft).toHaveValue("Keep this draft");
  expect(currentAuth.profileError).toBeNull();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "org:owner");
});

it("ignores a late membership recovery response after the signed-in account changes", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  let finish!: (value: unknown) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables: ["org_members"] } })));
  fixture.profileRead.mockResolvedValueOnce({ data: { id: "second", email: "second@example.test", company: "Second workspace", org_id: "second-org" }, error: null });
  act(() => fixture.onAuth?.("SIGNED_IN", { user: { id: "second", email: "second@example.test" } }));
  await waitFor(() => expect(currentAuth.profile?.id).toBe("second"));
  await act(async () => finish({ data: { ...fixture.user, company: "Personal workspace", org_id: "personal-org" }, error: null }));
  expect(currentAuth.profile?.id).toBe("second");
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "second-org:second");
});

it("keeps the verified same-account workspace mounted after a transport-only reconnect failure and on retry", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  const draft = screen.getByLabelText("Retained workspace draft");
  fireEvent.change(draft, { target: { value: "Preserve my ongoing chat" } });
  fixture.profileRead.mockResolvedValueOnce({ data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  await screen.findByRole("status");
  expect(currentAuth.profileError).toBeNull();
  expect(currentAuth.profileLoading).toBe(false);
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "org:owner");
  expect(screen.getByLabelText("Retained workspace draft")).toBe(draft);
  expect(draft).toHaveValue("Preserve my ongoing chat");
  await act(async () => { await currentAuth.reloadProfile(); });
  expect(currentAuth.profileRefreshError).toBeNull();
  expect(screen.getByLabelText("Retained workspace draft")).toBe(draft);
  expect(draft).toHaveValue("Preserve my ongoing chat");
});

it.each(["denied", "missing"])("still tears down the verified workspace after a confirmed %s profile", async reason => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  expect(screen.getByLabelText("Retained workspace draft")).toBeInTheDocument();
  fixture.profileRead.mockResolvedValueOnce(reason === "denied"
    ? { data: null, error: { code: "42501", message: "Permission denied" }, status: 403 }
    : { data: null, error: null, status: 200 });
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  await waitFor(() => expect(screen.queryByLabelText("Retained workspace draft")).not.toBeInTheDocument());
  expect(currentAuth.profileRefreshError).toBeNull();
  if (reason === "denied") expect(currentAuth.profileError).toBe("Permission denied");
  else expect(currentAuth.needsProfile).toBe(true);
});

it("does not retain an initial unverified workspace after a network failure", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  fixture.profileRead.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await screen.findByText("Failed to fetch");
  expect(currentAuth.profileRefreshError).toBeNull();
  expect(currentAuth.profileError).toBe("Failed to fetch");
  expect(currentAuth.needsProfile).toBe(false);
  expect(screen.queryByLabelText("Retained workspace draft")).not.toBeInTheDocument();
});

it("ignores a late reconnect transport error after the account has changed", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  let rejectEarlier!: (error: Error) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectEarlier = reject; }));
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  fixture.profileRead.mockResolvedValueOnce({ data: { id: "second", email: "second@example.test", name: "Second", company: "Second workspace", org_id: "other-org" }, error: null });
  act(() => fixture.onAuth?.("SIGNED_IN", { user: { id: "second", email: "second@example.test" } }));
  await waitFor(() => expect(currentAuth.profile?.id).toBe("second"));
  await act(async () => { rejectEarlier(new TypeError("Failed to fetch")); });
  expect(currentAuth.profileRefreshError).toBeNull();
  expect(currentAuth.profileError).toBeNull();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "other-org:second");
});

it.each(["returned", "rejected"])("ignores a stale JWT refresh failure (%s) after a newer verified profile read", async failure => {
  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Example"));
  let finish!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  fixture.refreshSession.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
  fixture.profileRead.mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 });
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  await waitFor(() => expect(fixture.refreshSession).toHaveBeenCalledOnce());
  fixture.profileRead.mockResolvedValueOnce({ data: { ...fixture.user, name: "Owner", company: "Fresh verified profile", org_id: "org" }, error: null });
  act(() => window.dispatchEvent(new Event("filey:cloud-change")));
  await waitFor(() => expect(currentAuth.profile?.company).toBe("Fresh verified profile"));
  await act(async () => {
    if (failure === "returned") finish({ data: { session: null }, error: { code: "403", message: "Earlier refresh denied" } });
    else reject(new TypeError("Failed to fetch"));
  });
  expect(currentAuth.profile?.company).toBe("Fresh verified profile");
  expect(currentAuth.profileError).toBeNull();
  expect(currentAuth.profileRefreshError).toBeNull();
  expect(screen.getByLabelText("Retained workspace draft")).toBeInTheDocument();
});

function SessionProbe() {
  const auth = useAuth();
  currentAuth = auth;
  return (
    <div data-testid="session" data-cache-scope={fixture.scope}>
      {auth.profileError && <span>{auth.profileError}</span>}
      {auth.profileRefreshError && <span role="status">{auth.profileRefreshError}</span>}
      {auth.loading || auth.profileLoading
        ? "Loading"
        : `${auth.user?.id}:${auth.profile?.company}:${auth.needsProfile ? "setup" : "ready"}`}
      {!auth.loading && !auth.profileLoading && !auth.profileError && auth.profile && <input key={`${auth.user?.id}:${auth.profile.org_id}`} aria-label="Retained workspace draft" defaultValue="" />}
    </div>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fixture.expired = false;
  fixture.assurance.mockReset().mockResolvedValue(false);
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
it("blocks a loaded cloud profile until security verification completes, keeps it blocked on failure and supports retry", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  let fail!: (error: Error) => void;
  fixture.assurance.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(fixture.assurance).toHaveBeenCalledOnce());
  expect(currentAuth.profileLoading).toBe(false);
  expect(currentAuth.mfaLoading).toBe(true);
  expect(currentAuth.mfaPending).toBe(true);
  await act(async () => { fail(new Error("Offline")); });
  expect(currentAuth.mfaLoading).toBe(false);
  expect(currentAuth.mfaPending).toBe(true);
  expect(currentAuth.mfaError).toMatch(/couldn't verify/i);
  await act(async () => { await currentAuth.refreshMfaPending(); });
  expect(currentAuth.mfaPending).toBe(false);
  expect(currentAuth.mfaError).toBeNull();
});

it("cannot unlock another cloud account with an earlier account's security response", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  let finish!: (required: boolean) => void;
  fixture.assurance.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(true);
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(fixture.assurance).toHaveBeenCalledOnce());
  await act(async () => { fixture.onAuth?.("SIGNED_IN", { user: { id: "second", email: "second@example.test" } }); });
  await waitFor(() => expect(fixture.assurance).toHaveBeenCalledTimes(2));
  await act(async () => { finish(false); });
  expect(currentAuth.user?.id).toBe("second");
  expect(currentAuth.mfaPending).toBe(true);
  expect(currentAuth.mfaLoading).toBe(false);
});

it("keeps the authorized device workspace available offline while cloud security lookup failures stay blocked", async () => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  adoptLocalProfile({ ...fixture.user, name: "Owner", company: "Example", org_id: "org" });
  setLocalSignedIn(false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.spyOn(localAuth, "hasLocalPassword").mockReturnValue(true);
  vi.spyOn(localAuth, "verifyLocalPassword").mockResolvedValue(true);
  fixture.assurance.mockRejectedValue(new Error("Offline"));
  const device = render(<AuthProvider><SessionProbe /></AuthProvider>);
  expect(currentAuth.user).toBeNull();
  await act(async () => {
    await currentAuth.signInWithPassword({ channel: "email", value: fixture.user.email }, "test-password");
    await currentAuth.refreshMfaPending();
  });
  expect(screen.getByText("owner:Example:ready")).toBeTruthy();
  expect(currentAuth.mfaLoading).toBe(false);
  expect(currentAuth.mfaPending).toBe(false);
  expect(currentAuth.mfaError).toBeNull();
  expect(fixture.assurance).not.toHaveBeenCalled();
  expect(fixture.signIn).not.toHaveBeenCalled();
  device.unmount();

  localStorage.setItem("filey_data_mode", "cloud");
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await waitFor(() => expect(currentAuth.mfaError).toMatch(/couldn't verify/i));
  expect(currentAuth.mfaLoading).toBe(false);
  expect(currentAuth.mfaPending).toBe(true);
  expect(fixture.assurance).toHaveBeenCalledOnce();
});
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

it("does not request paid entitlement to open the free local workspace", async () => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  setLocalSignedIn(true);
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  expect(currentAuth.user?.id).toBe("owner");
  expect(fixture.entitlement).not.toHaveBeenCalled();
});

it.each(["password", "otp"])("remembers the server-confirmed email after %s login", async (method) => {
  localStorage.setItem("filey_data_mode", "local");
  const verified = { ...fixture.user, email: "verified@example.test" };
  const response = { data: { user: verified, session: { user: verified } }, error: null };
  fixture.signIn.mockResolvedValue(response);
  fixture.verifyOtp.mockResolvedValue(response);
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => {
    const credential = { channel: "email" as const, value: "typed-alias@example.test" };
    if (method === "password") await currentAuth.signInWithPassword(credential, "test-password");
    else await currentAuth.verifyOtp(credential, "123456", "login");
  });
  expect(localAuth.getLocalCredential()?.email).toBe(verified.email);
  expect(currentAuth.user?.email).toBe(verified.email);
});

it("does not use a remembered identity when OTP returned no verified account", async () => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  fixture.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => {
    await expect(currentAuth.verifyOtp({ channel: "email", value: fixture.user.email }, "123456", "login"))
      .rejects.toThrow("did not confirm");
  });
  expect(currentAuth.user).toBeNull();
  expect(localAuth.isLocalSignedIn()).toBe(false);
});

it("rejects an OTP response whose user and session belong to different accounts", async () => {
  localStorage.setItem("filey_data_mode", "local");
  fixture.verifyOtp.mockResolvedValue({
    data: { user: fixture.user, session: { user: { id: "other", email: "other@example.test" } } }, error: null,
  });
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  await act(async () => {
    await expect(currentAuth.verifyOtp({ channel: "email", value: fixture.user.email }, "123456", "login"))
      .rejects.toThrow("did not confirm");
  });
  expect(localAuth.getLocalCredential()).toBeNull();
  expect(currentAuth.user).toBeNull();
});

it("cannot publish or remember a password response received after sign-out", async () => {
  localStorage.setItem("filey_data_mode", "local");
  let finish!: (value: unknown) => void;
  fixture.signIn.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  let response!: Promise<unknown>;
  act(() => {
    response = currentAuth.signInWithPassword({ channel: "email", value: fixture.user.email }, "test-password")
      .catch(error => error);
  });
  await act(async () => { await currentAuth.signOut(); });
  await act(async () => {
    finish({ data: { user: fixture.user, session: { user: fixture.user } }, error: null });
    expect(await response).toBeInstanceOf(Error);
  });
  expect(localAuth.rememberLocalCredential).not.toHaveBeenCalled();
  expect(localAuth.getLocalCredential()).toBeNull();
  expect(localAuth.isLocalSignedIn()).toBe(false);
  expect(currentAuth.user).toBeNull();
});

it("cannot adopt an earlier cloud profile or reopen the local workspace after sign-out", async () => {
  localStorage.setItem("filey_data_mode", "local");
  rememberLocalIdentity(fixture.user.email, fixture.user.id);
  adoptLocalProfile({ ...fixture.user, name: "Owner", company: "Original", org_id: "org" });
  let finish!: (value: unknown) => void;
  fixture.profileRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<AuthProvider><SessionProbe /></AuthProvider>);
  let response!: Promise<unknown>;
  act(() => {
    response = currentAuth.signInWithPassword({ channel: "email", value: fixture.user.email }, "test-password")
      .catch(error => error);
  });
  await waitFor(() => expect(fixture.profileRead).toHaveBeenCalledOnce());
  await act(async () => { await currentAuth.signOut(); });
  await act(async () => {
    finish({ data: { ...fixture.user, company: "Late company", org_id: "org" }, error: null });
    expect(await response).toBeInstanceOf(Error);
  });
  expect(JSON.parse(localStorage.getItem("filey_local_profile")!).company).toBe("Original");
  expect(localAuth.isLocalSignedIn()).toBe(false);
  expect(currentAuth.user).toBeNull();
  expect(screen.getByTestId("session")).toHaveAttribute("data-cache-scope", "signed out");
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
