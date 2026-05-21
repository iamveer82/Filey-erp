#!/usr/bin/env node
// Behavioral RLS regression test. Proves the multi-tenant security model
// actually behaves correctly (not just that policies exist):
//   - cross-org isolation
//   - no self role-escalation
//   - no org_id spoofing
//   - private-by-default + opt-in share
//   - shared records are read-only to other members
//
// Requires env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE.
// Skips (exit 0) if they are not set, so CI without secrets stays green.
// Run: node scripts/rls-test.mjs

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SR = process.env.SUPABASE_SERVICE_ROLE;

if (!URL || !ANON || !SR) {
  console.log("RLS test skipped — Supabase env not configured.");
  process.exit(0);
}

const admin = { apikey: SR, Authorization: `Bearer ${SR}` };
const J = { "Content-Type": "application/json" };

async function call(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { ...headers, ...(body ? J : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: res.status, data };
}

const U = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}` });
const mkUser = (email, password) =>
  call("/auth/v1/admin/users", { method: "POST", headers: admin, body: { email, password, email_confirm: true } });
const signIn = (email, password) =>
  call("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, body: { email, password } });

const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });

async function main() {
  const ts = Date.now();
  const ea = `rlsA_${ts}@example.com`, eb = `rlsB_${ts}@example.com`, PW = "Test123!pw";
  const ua = (await mkUser(ea, PW)).data;
  const ub = (await mkUser(eb, PW)).data;
  await new Promise((r) => setTimeout(r, 1500));
  const ta = (await signIn(ea, PW)).data.access_token;
  const tb = (await signIn(eb, PW)).data.access_token;
  const ubid = ub.id;

  const orgA = (await call("/rest/v1/profiles?select=org_id", { headers: U(ta) })).data[0].org_id;

  const ins = (await call("/rest/v1/products", { method: "POST", headers: { ...U(ta), Prefer: "return=representation" }, body: { sku: `SECRET_${ts}`, name: "A secret" } })).data;
  const pidA = Array.isArray(ins) && ins[0]?.id;
  check("A inserts own product", !!pidA);

  const b1 = (await call(`/rest/v1/products?sku=eq.SECRET_${ts}`, { headers: U(tb) })).data;
  check("Cross-org isolation: B cannot see A's product", Array.isArray(b1) && b1.length === 0);

  const add = (await call("/rest/v1/org_members", { method: "POST", headers: { ...U(ta), Prefer: "return=representation" }, body: { org_id: orgA, user_id: ubid, role: "staff" } })).data;
  check("Admin A adds B to own org", Array.isArray(add) && add.length > 0);

  await call(`/rest/v1/profiles?id=eq.${ubid}`, { method: "PATCH", headers: { ...U(tb), Prefer: "return=representation" }, body: { org_id: orgA } });
  const borg = (await call(`/rest/v1/profiles?id=eq.${ubid}&select=org_id`, { headers: U(tb) })).data[0].org_id;
  check("B can move into org it belongs to", borg === orgA);

  await call(`/rest/v1/org_members?user_id=eq.${ubid}&org_id=eq.${orgA}`, { method: "PATCH", headers: { ...U(tb), Prefer: "return=representation" }, body: { role: "owner" } });
  const brole = (await call(`/rest/v1/org_members?user_id=eq.${ubid}&org_id=eq.${orgA}&select=role`, { headers: U(tb) })).data[0].role;
  check("No self-escalation: staff B stays 'staff'", brole === "staff");

  const rnd = crypto.randomUUID();
  await call(`/rest/v1/profiles?id=eq.${ubid}`, { method: "PATCH", headers: { ...U(tb), Prefer: "return=representation" }, body: { org_id: rnd } });
  const borg3 = (await call(`/rest/v1/profiles?id=eq.${ubid}&select=org_id`, { headers: U(tb) })).data[0].org_id;
  check("No org spoof: B cannot set org_id to a non-member org", borg3 !== rnd);
  await call(`/rest/v1/profiles?id=eq.${ubid}`, { method: "PATCH", headers: { ...U(tb), Prefer: "return=representation" }, body: { org_id: orgA } });

  const b2 = (await call(`/rest/v1/products?sku=eq.SECRET_${ts}`, { headers: U(tb) })).data;
  check("Privacy: same-org member can't see A's PRIVATE product", Array.isArray(b2) && b2.length === 0);

  await call(`/rest/v1/products?id=eq.${pidA}`, { method: "PATCH", headers: { ...U(ta), Prefer: "return=representation" }, body: { shared: true } });
  const b3 = (await call(`/rest/v1/products?sku=eq.SECRET_${ts}`, { headers: U(tb) })).data;
  check("Sharing: B sees product after A shares", Array.isArray(b3) && b3.length === 1);

  await call(`/rest/v1/products?id=eq.${pidA}`, { method: "PATCH", headers: { ...U(tb), Prefer: "return=representation" }, body: { name: "HACKED" } });
  const nm = (await call(`/rest/v1/products?id=eq.${pidA}&select=name`, { headers: U(ta) })).data[0].name;
  check("Shared = read-only: B cannot edit A's shared product", nm !== "HACKED");

  // cleanup
  await call(`/rest/v1/products?id=eq.${pidA}`, { method: "DELETE", headers: { ...U(ta), Prefer: "return=representation" } });
  await call(`/auth/v1/admin/users/${ua.id}`, { method: "DELETE", headers: admin });
  await call(`/auth/v1/admin/users/${ub.id}`, { method: "DELETE", headers: admin });

  let failed = 0;
  for (const r of results) {
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.ok ? "" : "  (" + r.detail + ")"}`);
    if (!r.ok) failed++;
  }
  if (failed) { console.error(`\n${failed} RLS check(s) FAILED`); process.exit(1); }
  console.log("\nAll RLS checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
