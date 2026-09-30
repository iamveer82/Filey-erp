import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  licenseStatus,
  licenseActivate,
  licenseDeactivate,
  grantLicense,
} from "./license.ts";

type Result = { data: unknown; error: { code?: string; message: string } | null };
function fixture(results: Result[]) {
  const calls: unknown[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const result = results.shift();
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        order: () => q,
        update: () => q,
        maybeSingle: () => Promise.resolve(result),
        insert: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return q;
    },
    rpc(name: string, args: unknown) {
      calls.push([name, args]);
      return Promise.resolve(results.shift());
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
const failure: Result = { data: null, error: { message: "unavailable" } };

Deno.test("license lookup errors do not claim an account is unlicensed", async () => {
  assertEquals((await licenseStatus(fixture([failure]).client, "USER")).status, 503);
  assertEquals(
    (await licenseStatus(fixture([{ data: null, error: null }]).client, "USER")).body
      .licensed,
    false
  );
});
Deno.test(
  "activation fails closed on missing migration, slot refusal and malformed claim; no signing key is needed",
  async () => {
    for (const [response, status] of [
      [failure, 503],
      [{ data: null, error: { code: "PT404", message: "missing" } }, 404],
      [{ data: null, error: { code: "PT409", message: "full" } }, 409],
      [{ data: { product: "filey-desktop" }, error: null }, 503],
    ] as const) {
      const f = fixture([response]);
      assertEquals(
        (await licenseActivate(f.client, { id: "USER" }, "FP", "device")).status,
        status
      );
      assertEquals(f.calls, [
        [
          "filey_claim_license_device",
          { p_user: "USER", p_fingerprint: "FP", p_device_name: "device" },
        ],
      ]);
    }
  }
);
Deno.test("activation signs only the confirmed atomic claim", async () => {
  const old = Deno.env.get("LICENSE_SIGNING_KEY");
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
  Deno.env.set("LICENSE_SIGNING_KEY", btoa(String.fromCharCode(...bytes)));
  try {
    const f = fixture([
      { data: { license_id: "LICENSE", product: "filey-desktop" }, error: null },
    ]);
    const result = await licenseActivate(
      f.client,
      { id: "USER", email: "fixture@example.invalid" },
      "FP",
      "device"
    );
    assertEquals(result.status, 200);
    const token = String(result.body.token);
    const [body, sig] = token.split(".");
    const decode = (part: string) =>
      Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0)
      );
    assertEquals(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key.publicKey,
        decode(sig),
        decode(body)
      ),
      true
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(decode(body))).license_id,
      "LICENSE"
    );
  } finally {
    if (old === undefined) Deno.env.delete("LICENSE_SIGNING_KEY");
    else Deno.env.set("LICENSE_SIGNING_KEY", old);
  }
});
Deno.test("failed deactivation is never reported as ok", async () => {
  assertEquals(
    (await licenseDeactivate(fixture([failure]).client, "USER", "FP")).status,
    503
  );
  assertEquals(
    (
      await licenseDeactivate(
        fixture([{ data: { id: "LICENSE" }, error: null }, failure]).client,
        "USER",
        "FP"
      )
    ).status,
    503
  );
});
Deno.test("grant lookups must succeed before recording a paid license", async () => {
  for (const results of [[failure], [{ data: null, error: null }, failure]]) {
    const count = results.length;
    const f = fixture([...results]);
    await assertRejects(() => grantLicense(f.client, "USER", "PAYMENT"));
    assertEquals(f.calls.length, count);
  }
});
