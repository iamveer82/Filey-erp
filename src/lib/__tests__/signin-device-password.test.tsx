import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth, AuthProvider } from "../auth";
import { hasLocalPassword, rememberLocalIdentity } from "../localAuth";

/* A device that knows the account but was never given its password — the state
 * a code sign-in, or switching the device to offline, leaves behind. The account
 * itself is fine and its password IS in the cloud; what fails is the device's
 * ability to check it. The old single message blamed the password and told an
 * online user to "connect to the internet", which is the opposite of the fix.
 *
 * These tests pin that the message now names the real cause and always offers a
 * way forward. */

const signInWithPassword = vi.hoisted(() => vi.fn());
vi.mock("../supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../supabase")>();
  return {
    ...actual,
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        signInWithPassword,
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("../dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dataMode")>()),
  isLocalMode: () => true,
  effectiveDataMode: () => "local" as const,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: {} }),
  SupabaseClient: class {},
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

async function signIn(password = "correct horse battery") {
  const { result } = renderHook(
    () => useAuth() as unknown as { signInWithPassword: typeof signInWithPassword },
    { wrapper }
  );
  let caught: unknown;
  await act(async () => {
    caught = await result.current
      .signInWithPassword({ channel: "email", value: "owner@example.test" }, password)
      .catch((e: unknown) => e);
  });
  return { error: caught as Error | undefined, result };
}

beforeEach(() => {
  localStorage.clear();
  // Identity-only claim: the device knows who, never saw a password.
  rememberLocalIdentity("owner@example.test", "uid-1");
  expect(hasLocalPassword()).toBe(false);
  signInWithPassword.mockReset();
});

afterEach(() => vi.restoreAllMocks());

it("blames the unreachable cloud, not the password, when online", async () => {
  signInWithPassword.mockRejectedValue(new Error("Failed to fetch"));
  const { error } = await signIn();
  await waitFor(() => expect(error).toBeDefined());
  expect(error!.message).toMatch(/can't reach filey/i);
  expect(error!.message).toMatch(/one-time code/i);
  // The old wording blamed the device and told an online user to go online.
  expect(error!.message).not.toMatch(/never seen your password/i);
  expect(error!.message).not.toMatch(/connect to the internet/i);
});

it("says the password does not match when the cloud actually rejected it", async () => {
  signInWithPassword.mockRejectedValue(new Error("Invalid login credentials"));
  const { error } = await signIn("wrong-password");
  await waitFor(() => expect(error).toBeDefined());
  expect(error!.message).toMatch(/don't match your filey account/i);
  expect(error!.message).toMatch(/one-time code/i);
});

it("says it is offline when the cloud was never asked", async () => {
  const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { error } = await signIn();
  await waitFor(() => expect(error).toBeDefined());
  expect(error!.message).toMatch(/offline/i);
  expect(error!.message).toMatch(/one-time code/i);
  expect(signInWithPassword).not.toHaveBeenCalled();
  offline.mockRestore();
});

it("still accepts the password when the cloud confirms it, and teaches the device", async () => {
  signInWithPassword.mockResolvedValue({
    data: { user: { id: "uid-1", email: "owner@example.test" } },
    error: null,
  });
  const { error } = await signIn();
  await waitFor(() => expect(error).toBeUndefined());
  // The whole point: after one online success the device can verify offline.
  await waitFor(() => expect(hasLocalPassword()).toBe(true));
});
