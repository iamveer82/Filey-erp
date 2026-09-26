import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createRecoveryClient, requestPasswordResetEmail, supabase } from "../supabase";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({
  auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) },
})) }));
vi.mock("../localdb", () => ({ localClient: {} }));

beforeEach(() => vi.clearAllMocks());

it("isolates password recovery from persisted app sessions and URL callbacks", () => {
  createRecoveryClient();
  expect(createClient).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), {
    auth: {
      storageKey: "filey-password-recovery",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
});

it("sends through native Auth on an isolated client, never the app's expired session", async () => {
  await requestPasswordResetEmail("  Owner@Example.test  ");
  const results = vi.mocked(createClient).mock.results;
  const client = results[results.length - 1].value;
  expect(client.auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("owner@example.test");
  expect(supabase?.auth.resetPasswordForEmail).not.toHaveBeenCalled();
});

it("rejects malformed addresses before contacting Auth", async () => {
  await expect(requestPasswordResetEmail("a@example.test,b@example.test")).rejects.toThrow("email address");
  expect(createClient).not.toHaveBeenCalled();
});

it.each([
  [{ status: 429, message: "internal detail" }, "Too many reset requests"],
  [{ status: 503, message: "sensitive provider detail" }, "Could not send the reset email"],
])("surfaces send failures without retrying or exposing provider details (%j)", async (error, message) => {
  const send = vi.fn().mockResolvedValue({ error });
  vi.mocked(createClient).mockReturnValueOnce({ auth: { resetPasswordForEmail: send } } as never);
  await expect(requestPasswordResetEmail("owner@example.test")).rejects.toThrow(message);
  expect(send).toHaveBeenCalledTimes(1);
});
