import { expect, it, vi } from "vitest";

// The server answers 503 while Filey's own Instagram setup is unfinished, in words
// meant for its operator. A customer must not be told to set server settings.
vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
  invokeFn: async () => ({
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: { status: 503, json: async () => ({ error: "Instagram isn't configured on the server yet. Ask the Filey administrator to set IG_APP_ID and IG_APP_SECRET." }) },
    }),
  }),
}));

import { instagram } from "../instagram";

it("tells the customer Instagram is not switched on yet, without server setting names", async () => {
  const failure = await instagram.connectUrl().then(() => null, (e: Error) => e.message);
  expect(failure).toContain("isn't switched on yet");
  expect(failure).not.toContain("IG_APP_ID");
});
