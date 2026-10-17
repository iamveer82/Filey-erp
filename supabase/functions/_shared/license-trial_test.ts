// deno-lint-ignore-file no-explicit-any
import { TRIAL_DAYS, trialActivate } from "./license.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

// A stand-in for the service-role client: licences, the trial devices and the welcome credit.
function fakeDb(licensed = new Set<string>()) {
  const trials = new Map<string, { user_id: string; started_at: string }>();
  const welcomed = new Set<string>();
  const chain = (table: string) => {
    const where: Record<string, unknown> = {};
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (col: string, val: unknown) => { where[col] = val; return q; },
      maybeSingle: async () => {
        if (table === "licenses") return { data: licensed.has(String(where.user_id)) ? { id: "lic", product: "filey-desktop", created_at: "" } : null, error: null };
        const row = trials.get(String(where.fingerprint));
        return { data: row ?? null, error: null };
      },
      upsert: async (row: { fingerprint: string; user_id: string; started_at: string }) => {
        if (!trials.has(row.fingerprint)) trials.set(row.fingerprint, { user_id: row.user_id, started_at: row.started_at });
        return { error: null };
      },
    };
    return q;
  };
  return {
    welcomed,
    supa: {
      from: chain,
      rpc: async (_name: string, args: { p_user: string }) => {
        const fresh = !welcomed.has(args.p_user);
        welcomed.add(args.p_user);
        return { data: fresh, error: null };
      },
    } as any,
  };
}

async function signingKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  Deno.env.set("LICENSE_SIGNING_KEY", btoa(String.fromCharCode(...pkcs8)));
}

const day = 86_400_000;
const at = (iso: string) => new Date(iso);
const account = (id: string, created: string) => ({ id, email: `${id}@example.com`, created_at: created, email_confirmed_at: created });
const payload = (token: string) => JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));

Deno.test("a new account gets 14 days and the $1 welcome credit once", async () => {
  await signingKey();
  const { supa, welcomed } = fakeDb();
  const user = account("u1", "2026-10-17T08:00:00Z");
  const first = await trialActivate(supa, user, "device-aaaa-1111", at("2026-10-18T08:00:00Z"));
  assert(first.status === 200 && first.body.welcome_credit === true);
  assert(first.body.ends === new Date(Date.parse(user.created_at) + TRIAL_DAYS * day).toISOString());
  const claims = payload(String(first.body.token));
  assert(claims.product === "filey-trial" && claims.device_id === "device-aaaa-1111" && claims.ends === first.body.ends);
  const again = await trialActivate(supa, user, "device-aaaa-1111", at("2026-10-19T08:00:00Z"));
  assert(again.body.welcome_credit === false && welcomed.size === 1, "The welcome credit was given twice");
});

Deno.test("a second computer shares the account's window; a new email on a used computer starts none", async () => {
  await signingKey();
  const { supa } = fakeDb();
  const owner = account("u1", "2026-10-01T00:00:00Z");
  const first = await trialActivate(supa, owner, "device-pc-one", at("2026-10-02T00:00:00Z"));
  const second = await trialActivate(supa, owner, "device-pc-two", at("2026-10-05T00:00:00Z"));
  assert(first.body.ends === second.body.ends, "A second device restarted the account's trial");
  const newcomer = account("u2", "2026-10-20T00:00:00Z");
  const reused = await trialActivate(supa, newcomer, "device-pc-one", at("2026-10-20T00:00:00Z"));
  assert(Date.parse(String(reused.body.ends)) === Date.parse("2026-10-02T00:00:00Z") + TRIAL_DAYS * day, "A new email restarted the device's trial");
  assert(reused.body.welcome_credit === false, "An expired device window still gave a welcome credit");
});

Deno.test("an account that owns Freedom is told to activate it instead", async () => {
  const { supa } = fakeDb(new Set(["u9"]));
  const result = await trialActivate(supa, account("u9", "2026-01-01T00:00:00Z"), "device-zzzz-9999");
  assert(result.status === 200 && result.body.licensed === true && !result.body.token);
});
