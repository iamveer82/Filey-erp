// Retry helper: retries cold-start blob/boot misses, not business errors.
import { describe, it, expect, vi } from "vitest";
import { invokeFn } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

// Minimal fake client whose functions.invoke returns a scripted queue.
function fakeClient(results: { data?: unknown; error?: unknown }[]) {
  const invoke = vi.fn().mockImplementation(() => Promise.resolve(results.shift()));
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

const httpErr = (status: number) => ({ context: { status }, message: "non-2xx" });

describe("invokeFn", () => {
  it("returns immediately on success (no retry)", async () => {
    const { client, invoke } = fakeClient([{ data: { url: "ok" }, error: null }]);
    const r = await invokeFn(client, "stripe", { body: {} });
    expect((r.data as { url: string }).url).toBe("ok");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retries a 404 blob miss, then succeeds", async () => {
    const { client, invoke } = fakeClient([
      { data: null, error: httpErr(404) },
      { data: { url: "warm" }, error: null },
    ]);
    const r = await invokeFn(client, "stripe", { body: {} });
    expect((r.data as { url: string }).url).toBe("warm");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a business 400", async () => {
    const { client, invoke } = fakeClient([
      { data: null, error: httpErr(400) },
      { data: { url: "should-not-reach" }, error: null },
    ]);
    const r = await invokeFn(client, "stripe", { body: {} });
    expect(r.error).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("gives up after retries exhausted on persistent 503", async () => {
    const { client, invoke } = fakeClient([
      { data: null, error: httpErr(503) },
      { data: null, error: httpErr(503) },
      { data: null, error: httpErr(503) },
    ]);
    const r = await invokeFn(client, "stripe", { body: {} }, 2);
    expect(r.error).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
