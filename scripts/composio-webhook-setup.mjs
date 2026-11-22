#!/usr/bin/env node
// One-time: point Filey's Composio project at the composio-webhook function, so
// live app events reach Filey. Run from the repo root:
//
//   node scripts/composio-webhook-setup.mjs          # show what is set now (changes nothing)
//   node scripts/composio-webhook-setup.mjs --apply  # create the subscription, or fix its URL/events
//
// Reads COMPOSIO_API_KEY from .env.local. The subscription's signing secret is
// written to ~/.filey/composio-webhook-secret.txt and never printed: add that
// text in Supabase → Edge Functions → Secrets as COMPOSIO_WEBHOOK_SECRET.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "https://backend.composio.dev/api/v3.1";
const URL_TARGET = "https://voyrjqgaypiylwskkwpr.functions.supabase.co/composio-webhook";
const EVENTS = ["composio.trigger.message", "composio.connected_account.expired"];
const apply = process.argv.includes("--apply");

const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const key = (env.match(/^COMPOSIO_API_KEY=(.*)$/m)?.[1] ?? process.env.COMPOSIO_API_KEY ?? "").trim();
if (!key) { console.error("No COMPOSIO_API_KEY in .env.local."); process.exit(1); }
const headers = { "x-api-key": key, "Content-Type": "application/json" };

async function api(method, route, body) {
  const res = await fetch(`${BASE}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "error" });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
  if (!res.ok) throw new Error(`${method} ${route} → HTTP ${res.status}: ${(json.error?.message ?? json.message ?? text).toString().slice(0, 200)}`);
  return json;
}

function saveSecret(secret) {
  if (typeof secret !== "string" || !secret) throw new Error("Composio did not return a signing secret.");
  const dir = path.join(os.homedir(), ".filey");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "composio-webhook-secret.txt");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.log(`Signing secret saved to ${file} (${secret.length} characters, not shown).`);
}

const list = await api("GET", "/webhook_subscriptions");
const subs = Array.isArray(list.items) ? list.items : Array.isArray(list) ? list : [];
const current = subs[0];
if (current) {
  const ok = current.webhook_url === URL_TARGET && EVENTS.every((e) => (current.enabled_events ?? []).includes(e));
  console.log(`Existing subscription ${current.id}: ${current.webhook_url} [${(current.enabled_events ?? []).join(", ")}] version ${current.version}`);
  if (!apply) { console.log(ok ? "It already points at Filey." : "It does not point at Filey's webhook yet. Re-run with --apply to change it."); process.exit(0); }
  if (current.webhook_url && current.webhook_url !== URL_TARGET && !process.argv.includes("--replace")) {
    console.log(`It points somewhere else. Composio allows one subscription per project; re-run with --apply --replace to move it to ${URL_TARGET}.`);
    process.exit(2);
  }
  if (!ok) await api("PATCH", `/webhook_subscriptions/${encodeURIComponent(current.id)}`, { webhook_url: URL_TARGET, enabled_events: EVENTS });
  const full = await api("GET", `/webhook_subscriptions/${encodeURIComponent(current.id)}`);
  saveSecret(full.secret);
  console.log(ok ? "Subscription unchanged." : `Subscription now delivers ${EVENTS.join(", ")} to ${URL_TARGET}.`);
} else {
  console.log("No webhook subscription on this Composio project yet.");
  if (!apply) { console.log("Re-run with --apply to create it."); process.exit(0); }
  const made = await api("POST", "/webhook_subscriptions", { webhook_url: URL_TARGET, enabled_events: EVENTS, version: "V3" });
  saveSecret(made.secret);
  console.log(`Created subscription ${made.id}: ${EVENTS.join(", ")} → ${URL_TARGET}.`);
}
