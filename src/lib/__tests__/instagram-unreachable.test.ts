import { afterEach, expect, it, vi } from "vitest";

// The Instagram service not answering (offline, or not switched on) must read as that,
// not as the raw "Failed to send a request to the Edge Function".
vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
  invokeFn: async () => ({ data: null, error: Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }) }),
}));

import { instagram } from "../instagram";

afterEach(() => { vi.restoreAllMocks(); });

it("says the Instagram service is out of reach instead of the transport error", async () => {
  await expect(instagram.connections()).rejects.toThrow("Instagram DMs isn't available right now");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(instagram.connections()).rejects.toThrow("You're offline");
});
