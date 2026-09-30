import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchStripeAction } from "./stripe-actions.ts";

Deno.test(
  "unsupported invoice checkout cannot invoke Stripe, auth or storage",
  async () => {
    const oldFetch = globalThis.fetch;
    let networkCalls = 0,
      billingCalls = 0;
    globalThis.fetch = () => {
      networkCalls++;
      throw new Error("Unexpected network call");
    };
    try {
      const response = await dispatchStripeAction(
        "pay_invoice",
        () => {
          billingCalls++;
          return fetch("https://fixture.invalid");
        },
        { "Access-Control-Allow-Origin": "*" }
      );
      assertEquals(response.status, 410);
      assertStringIncludes((await response.json()).error, "Contact the seller");
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
      assertEquals(networkCalls, 0);
      assertEquals(billingCalls, 0);
    } finally {
      globalThis.fetch = oldFetch;
    }
  }
);
Deno.test(
  "Filey's own license and plan billing actions retain their authenticated handler",
  async () => {
    for (const action of [
      "license_activate",
      "license_deactivate",
      "checkout",
      "checkout_lite",
      "portal",
    ]) {
      let calls = 0;
      const response = await dispatchStripeAction(
        action,
        () => {
          calls++;
          return Promise.resolve(Response.json({ authenticated: true }));
        },
        {}
      );
      assertEquals(calls, 1);
      assertEquals(await response.json(), { authenticated: true });
    }
  }
);
