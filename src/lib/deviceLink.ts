/* Filey Link — the devices signed in to one Filey account find and use each other.
 *
 * Every app instance (desktop, phone, browser) joins its account's private
 * Realtime topic `filey-link:<uid>` and announces itself with presence. Only that
 * account can join it (supabase/2026-10-14-device-link.sql). Desktops host: a
 * phone or browser paired once at the computer sends signed requests, and the
 * desktop runs them with its own engine, model, tools and records.
 *
 * Trust: one account is not enough to drive a computer, because a leaked session
 * token would then be. Each device holds a non-extractable ECDSA P-256 key.
 * Pairing stores the phone's public key on the desktop after the owner approves
 * at the computer and the 6-digit codes on both screens match. Every request is
 * signed, fresh and single-use; follow-ups only count from the device that made
 * the request. Nothing passes through a Filey server or is stored.
 *
 * ponytail: Realtime broadcast is at-most-once. A lost reply stalls its call until
 * the client's silence timeout; add a host replay buffer if that shows up. */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { effectiveDataMode } from "./dataMode";
import { isNativeApp } from "./nativePlatform";

export type DeviceKind = "desktop" | "mobile" | "web";
export interface LinkedDevice {
  id: string;
  label: string;
  kind: DeviceKind;
  /** Runs requests from paired devices (the desktop app). */
  host: boolean;
  mode: "cloud" | "local";
  since: number;
}
export interface PairRequest { id: string; label: string; kind: DeviceKind; code: string }
export interface TrustedDevice { id: string; label: string; kind: DeviceKind; key: JsonWebKey; pairedAt: number }
export interface LinkReply { type: "accepted" | "event" | "confirm" | "alive" | "result" | "error"; data?: unknown }
export interface HostCall {
  id: string;
  device: TrustedDevice;
  signal: AbortSignal;
  emit(type: "event", data: unknown): Promise<void>;
  /** Asks the requesting device's owner; false on timeout, cancel or disconnect. */
  ask(name: string, args: Record<string, unknown>): Promise<boolean>;
}
export type LinkHandler = (params: Record<string, unknown>, call: HostCall) => Promise<unknown>;

/** The request never reached a computer that took it: safe to do the work elsewhere. */
export class LinkUnavailable extends Error {
  constructor(message: string, readonly code = "unavailable") { super(message); this.name = "LinkUnavailable"; }
}

const FRESH_MS = 5 * 60_000;
const HEARTBEAT_MS = 10_000;
const CONFIRM_MS = 10 * 60_000;
const MAX_CALLS = 3;
/** Under Realtime's broadcast payload limit, with room for the envelope. */
const MAX_MESSAGE = 120_000;
const DEVICE_KEY = "filey.link.device";
const topic = (uid: string) => `filey-link:${uid}`;
const trustKey = (uid: string) => `filey.link.trusted:${uid}`;
const hostsKey = (uid: string) => `filey.link.hosts:${uid}`;
export const LINK_ACTIVITY_EVENT = "filey:link-activity";

export const isDesktopApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- identity -----------------------------------------------------------------

let memoryId: string | undefined;
export function thisDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return memoryId ??= crypto.randomUUID();
  }
}

export function thisDevice(): Omit<LinkedDevice, "since"> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  const kind: DeviceKind = isDesktopApp() ? "desktop" : isNativeApp() ? "mobile" : "web";
  const label = kind === "desktop" ? `${os} computer` : kind === "mobile" ? (os === "Android" ? "Android phone" : os) : `${browser} on ${os}`;
  return { id: thisDeviceId(), label, kind, host: kind === "desktop", mode: effectiveDataMode() };
}

interface DeviceKeys { privateKey: CryptoKey; publicKey: JsonWebKey }
let keys: Promise<DeviceKeys> | undefined;

function keyStore<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("filey-link", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = op(db.transaction("keys", mode).objectStore("keys"));
      request.onsuccess = () => { resolve(request.result as T); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  });
}

/** This device's signing key. The private half can sign but never be read out. */
export function deviceKeys(): Promise<DeviceKeys> {
  keys ??= (async () => {
    const id = thisDeviceId();
    const saved = await keyStore<DeviceKeys | undefined>("readonly", s => s.get(id)).catch(() => undefined);
    if (saved?.privateKey && saved.publicKey) return saved;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const fresh = { privateKey: pair.privateKey, publicKey: { kty, crv, x, y } };
    // Without IndexedDB the key lasts this session only; pairing again restores the link.
    await keyStore("readwrite", s => s.put(fresh, id)).catch(() => {});
    return fresh;
  })().catch(error => { keys = undefined; throw error; });
  return keys;
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const validKey = (key: unknown): key is JsonWebKey => !!key && typeof key === "object"
  && (key as JsonWebKey).kty === "EC" && (key as JsonWebKey).crv === "P-256"
  && typeof (key as JsonWebKey).x === "string" && typeof (key as JsonWebKey).y === "string";

async function verify(key: JsonWebKey, body: string, signature: string): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("jwk", { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromBase64(signature), utf8(body));
  } catch {
    return false;
  }
}

/** Short code both screens show while pairing; equal codes mean the computer got this device's key. */
export async function pairingCode(key: JsonWebKey): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(`${key.x}.${key.y}`)));
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

// ---- stored relationships (per account, per device) -----------------------------

function readJson<T extends object>(key: string): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {} as T;
  } catch {
    return {} as T;
  }
}
function writeJson(key: string, value: object) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stays as it was */ }
  notify();
}

/** Desktop: the devices allowed to use this computer. */
export function trustedDevices(): TrustedDevice[] {
  return state ? Object.values(readJson<Record<string, TrustedDevice>>(trustKey(state.uid))) : [];
}
export function forgetDevice(id: string): void {
  if (!state) return;
  const trusted = readJson<Record<string, TrustedDevice>>(trustKey(state.uid));
  delete trusted[id];
  writeJson(trustKey(state.uid), trusted);
  for (const call of calls.values()) if (call.device.id === id) call.controller.abort();
}

/** Phone or browser: the computers this device has paired with. */
export function pairedHosts(): Record<string, { label: string; pairedAt: number }> {
  return state ? readJson(hostsKey(state.uid)) : {};
}
export function forgetHost(id: string): void {
  if (!state) return;
  const hosts = pairedHosts();
  delete hosts[id];
  writeJson(hostsKey(state.uid), hosts);
}

// ---- channel and presence -------------------------------------------------------

interface LinkState { uid: string; channel: RealtimeChannel; joined: Promise<void> }
let state: LinkState | undefined;
/** The signed-in account the link should be joined for, and the backoff for failed joins. */
let wantedUid: string | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 0;
const listeners = new Set<() => void>();
function notify() { listeners.forEach(cb => { try { cb(); } catch { /* one listener can't starve the rest */ } }); }

/** Re-renders device lists and status chips. */
export function onDeviceLinkChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function join(uid: string): LinkState {
  const client = supabase!;
  const channel = client.channel(topic(uid), { config: { private: true, presence: { key: thisDeviceId(), enabled: true } } });
  let synced!: () => void;
  const firstSync = new Promise<void>(resolve => { synced = resolve; });
  channel.on("presence", { event: "sync" }, () => { synced(); notify(); });
  channel.on("broadcast", { event: "res" }, ({ payload }) => onReply(payload));
  channel.on("broadcast", { event: "req" }, ({ payload }) => void onRequest(payload).catch(() => {}));
  const joined = (async () => {
    // Private topics are authorized by the signed-in session.
    await client.realtime.setAuth();
    await new Promise<void>((resolve, reject) => channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        reject(error ?? new Error(`Device link ${status.toLowerCase()}`));
    }));
    await channel.track({ ...thisDevice(), since: Date.now() });
    await Promise.race([firstSync, new Promise(resolve => setTimeout(resolve, 3000))]);
    retryDelay = 0;
  })();
  const next = { uid, channel, joined };
  joined.catch(() => {
    if (state !== next) return;
    state = undefined;
    void client.removeChannel(channel);
    notify();
    // Realtime creates its daily message partitions only after a join fails for
    // the missing one (MissingPartition), so the next try usually succeeds.
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 15_000, 5 * 60_000);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!state && wantedUid === uid) join(uid); }, retryDelay);
  });
  state = next;
  notify();
  return next;
}

function leave() {
  clearTimeout(retryTimer);
  retryDelay = 0;
  const current = state;
  if (!current) return;
  state = undefined;
  for (const call of calls.values()) call.controller.abort();
  void supabase?.removeChannel(current.channel);
  notify();
}

/** Joined link for the signed-in account; joins again if an earlier try failed. */
async function ensureLink(): Promise<LinkState> {
  if (!supabase) throw new LinkUnavailable("Cloud isn't available in this build.");
  if (!state) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new LinkUnavailable("Sign in to your Filey account to use your other devices.");
    if (!state) join(data.session.user.id);
  }
  const current = state!;
  try { await current.joined; }
  catch { throw new LinkUnavailable("Couldn't reach your other devices."); }
  return current;
}

/** Starts for the life of the app: follows sign-in, sign-out and account changes. */
export function startDeviceLink(): () => void {
  if (!supabase || typeof window === "undefined") return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // Outside the auth callback: joining reads the session, which would wait on this callback.
    setTimeout(() => {
      const uid = session?.user.id;
      wantedUid = uid;
      if (uid === state?.uid) return;
      leave();
      if (uid) join(uid);
    }, 0);
  });
  return () => { wantedUid = undefined; data.subscription.unsubscribe(); leave(); };
}

/** The account's other devices that are open right now. */
export function linkedDevices(): LinkedDevice[] {
  if (!state) return [];
  const me = thisDeviceId();
  return Object.entries(state.channel.presenceState<Partial<LinkedDevice>>()).flatMap(([key, metas]) => {
    const d = metas[0];
    if (!d || key === me) return [];
    const kind: DeviceKind = d.kind === "desktop" || d.kind === "mobile" ? d.kind : "web";
    return [{ id: key, label: String(d.label ?? "Device").slice(0, 60), kind, host: d.host === true,
      mode: d.mode === "local" ? "local" : "cloud", since: Number(d.since) || 0 }];
  });
}

/** The paired computer that is open now; one per account so a request runs once. */
export function linkedHost(): LinkedDevice | undefined {
  if (isDesktopApp()) return undefined;
  const paired = pairedHosts();
  return linkedDevices().filter(d => d.host && paired[d.id]).sort((a, b) => a.id.localeCompare(b.id))[0];
}

// ---- client: requests to a computer ---------------------------------------------

const inbox = new Map<string, (reply: LinkReply & { seq: number }) => void>();

function onReply(payload: unknown) {
  const p = payload as { to?: unknown; re?: unknown; seq?: unknown; type?: unknown; data?: unknown };
  if (p?.to !== thisDeviceId() || typeof p.re !== "string" || typeof p.seq !== "number" || typeof p.type !== "string") return;
  inbox.get(p.re)?.({ seq: p.seq, type: p.type as LinkReply["type"], data: p.data });
}

async function sendSigned(link: LinkState, to: string, body: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(body);
  if (text.length > MAX_MESSAGE) throw new LinkUnavailable("This request is too large to hand to your computer.");
  const { privateKey } = await deviceKeys();
  const sig = toBase64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, utf8(text)));
  const status = await link.channel.send({ type: "broadcast", event: "req", payload: { from: thisDeviceId(), to, body: text, sig } });
  if (status !== "ok") throw new LinkUnavailable("Couldn't reach your computer.");
}

export interface LinkSession {
  id: string;
  /** The next reply in order. Throws when the computer is gone or silent past `timeoutMs`. */
  next(timeoutMs: number, signal?: AbortSignal): Promise<LinkReply>;
  /** A signed follow-up for this request: `answer` or `cancel`. */
  send(method: "answer" | "cancel", params?: Record<string, unknown>): Promise<void>;
  close(): void;
}

export async function openLinkSession(to: string, method: string, params: Record<string, unknown>): Promise<LinkSession> {
  const link = await ensureLink();
  const id = crypto.randomUUID();
  const me = thisDeviceId();
  const buffered = new Map<number, LinkReply>();
  let expected = 0;
  let wake: (() => void) | undefined;
  inbox.set(id, reply => { buffered.set(reply.seq, reply); wake?.(); });
  try {
    await sendSigned(link, to, { id, from: me, to, method, params, ts: Date.now() });
  } catch (error) {
    inbox.delete(id);
    throw error;
  }
  return {
    id,
    async next(timeoutMs, signal) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        signal?.throwIfAborted();
        const reply = buffered.get(expected);
        if (reply) {
          buffered.delete(expected++);
          return reply;
        }
        if (state !== link || !linkedDevices().some(d => d.id === to)) throw new Error("Your computer went offline.");
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("Your computer stopped responding.");
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); wake = undefined; resolve(); };
          const timer = setTimeout(done, Math.min(left, 1000));
          signal?.addEventListener("abort", done, { once: true });
          wake = done;
        });
      }
    },
    send: (followUp, followParams = {}) =>
      sendSigned(link, to, { id: crypto.randomUUID(), re: id, from: me, to, method: followUp, params: followParams, ts: Date.now() }),
    close: () => { inbox.delete(id); },
  };
}

/** Pairs this phone or browser with an open computer. Resolves once the owner approves there. */
export async function pairWith(host: LinkedDevice): Promise<void> {
  const { publicKey } = await deviceKeys();
  const me = thisDevice();
  const session = await openLinkSession(host.id, "pair", { label: me.label, kind: me.kind, key: publicKey });
  try {
    for (;;) {
      const reply = await session.next(CONFIRM_MS);
      if (reply.type === "error") throw new Error(String((reply.data as { message?: string })?.message || "The computer didn't connect."));
      if (reply.type === "result") break;
    }
    const link = await ensureLink();
    writeJson(hostsKey(link.uid), { ...pairedHosts(), [host.id]: { label: host.label, pairedAt: Date.now() } });
  } finally {
    session.close();
  }
}

/** This device's pairing code, to compare with the one the computer shows. */
export async function myPairingCode(): Promise<string> {
  return pairingCode((await deviceKeys()).publicKey);
}

// ---- host: the desktop answering paired devices -----------------------------------

const handlers = new Map<string, LinkHandler>();
const calls = new Map<string, { device: TrustedDevice; controller: AbortController; answers: Map<string, (ok: boolean) => void> }>();
const seen = new Map<string, number>();
let approver: ((request: PairRequest) => Promise<boolean>) | undefined;
let pairing = false;

export function registerLinkMethod(method: string, handler: LinkHandler): void {
  handlers.set(method, handler);
}

/** The desktop UI that asks the owner to approve a new device. */
export function setPairApprover(fn: (request: PairRequest) => Promise<boolean>): () => void {
  approver = fn;
  return () => { if (approver === fn) approver = undefined; };
}

function reply(link: LinkState, to: string, re: string, seq: number, type: LinkReply["type"], data?: unknown): Promise<void> {
  if (state !== link) return Promise.resolve();
  let payload: Record<string, unknown> = { to, re, seq, type, data };
  // Keep the order intact: an event too large to send becomes a heartbeat.
  if (JSON.stringify(payload).length > MAX_MESSAGE)
    payload = type === "event" ? { to, re, seq, type: "alive" } : { to, re, seq, type: "error", data: { message: "The answer was too large to send to your device." } };
  return link.channel.send({ type: "broadcast", event: "res", payload }).then(() => {}, () => {});
}

interface RequestBody { id: string; re?: string; from: string; to: string; method: string; params: Record<string, unknown>; ts: number }

async function onRequest(payload: unknown) {
  const link = state;
  const me = thisDeviceId();
  const env = payload as { from?: unknown; to?: unknown; body?: unknown; sig?: unknown };
  if (!link || !isDesktopApp() || env?.to !== me || typeof env.from !== "string" || typeof env.body !== "string"
    || typeof env.sig !== "string" || env.body.length > MAX_MESSAGE) return;
  let body: RequestBody;
  try { body = JSON.parse(env.body); } catch { return; }
  if (!body || body.from !== env.from || body.to !== me || typeof body.id !== "string" || typeof body.method !== "string"
    || !body.params || typeof body.params !== "object" || Array.isArray(body.params)) return;
  const now = Date.now();
  if (Math.abs(now - Number(body.ts)) > FRESH_MS || seen.has(body.id)) return;
  const from = env.from;
  const trusted = readJson<Record<string, TrustedDevice>>(trustKey(link.uid))[from];
  const key = body.method === "pair" ? body.params.key : trusted?.key;
  if (!validKey(key) || !(await verify(key, env.body, env.sig))) {
    if (!trusted && body.method !== "pair" && body.method !== "answer" && body.method !== "cancel")
      void reply(link, from, body.id, 0, "error", { message: "This device isn't connected to the computer yet.", code: "not_paired" });
    return;
  }
  for (const [id, until] of seen) if (until < now) seen.delete(id);
  seen.set(body.id, now + 2 * FRESH_MS);

  if (body.method === "pair") return pair(link, body, from, key);
  if (!trusted) return;
  if (body.method === "answer" || body.method === "cancel") {
    const call = typeof body.re === "string" ? calls.get(body.re) : undefined;
    if (!call || call.device.id !== from) return;
    if (body.method === "cancel") call.controller.abort();
    else call.answers.get(String(body.params.cid))?.(body.params.ok === true);
    return;
  }
  const handler = handlers.get(body.method);
  let seq = 0;
  const send = (type: LinkReply["type"], data?: unknown) => reply(link, from, body.id, seq++, type, data);
  if (!handler) return void send("error", { message: `The computer can't run "${body.method}".` });
  if (calls.size >= MAX_CALLS) return void send("error", { message: "Your computer is busy with other requests.", code: "busy" });

  const controller = new AbortController();
  const answers = new Map<string, (ok: boolean) => void>();
  calls.set(body.id, { device: trusted, controller, answers });
  const call: HostCall = {
    id: body.id,
    device: trusted,
    signal: controller.signal,
    emit: (_type, data) => send("event", data),
    ask: (name, args) => new Promise<boolean>(resolve => {
      if (controller.signal.aborted) return resolve(false);
      const cid = crypto.randomUUID();
      const settle = (ok: boolean) => {
        clearTimeout(timer);
        answers.delete(cid);
        controller.signal.removeEventListener("abort", deny);
        resolve(ok);
      };
      const deny = () => settle(false);
      const timer = setTimeout(deny, CONFIRM_MS);
      controller.signal.addEventListener("abort", deny, { once: true });
      answers.set(cid, settle);
      void send("confirm", { cid, name, args });
    }),
  };
  window.dispatchEvent(new CustomEvent(LINK_ACTIVITY_EVENT, { detail: { device: trusted.label, method: body.method } }));
  await send("accepted");
  const beat = setInterval(() => void send("alive"), HEARTBEAT_MS);
  try {
    const value = await handler(body.params, call);
    await send("result", value);
  } catch (error) {
    await send("error", { message: error instanceof Error ? error.message : String(error), stopped: controller.signal.aborted });
  } finally {
    clearInterval(beat);
    calls.delete(body.id);
    controller.abort();
  }
}

async function pair(link: LinkState, body: RequestBody, from: string, key: JsonWebKey) {
  const label = String(body.params.label || "Device").slice(0, 60);
  const kind: DeviceKind = body.params.kind === "mobile" || body.params.kind === "desktop" ? body.params.kind : "web";
  const host = { id: thisDeviceId(), label: thisDevice().label };
  const trusted = readJson<Record<string, TrustedDevice>>(trustKey(link.uid));
  if (trusted[from]?.key.x === key.x && trusted[from]?.key.y === key.y)
    return void reply(link, from, body.id, 0, "result", { host });
  if (!approver) return void reply(link, from, body.id, 0, "error", { message: "Open Filey on your computer to approve this device." });
  if (pairing) return void reply(link, from, body.id, 0, "error", { message: "Another device is waiting for approval on the computer." });
  pairing = true;
  try {
    await reply(link, from, body.id, 0, "accepted");
    const ok = await approver({ id: from, label, kind, code: await pairingCode(key) });
    if (state !== link) return;
    if (!ok) return void reply(link, from, body.id, 1, "error", { message: "The connection wasn't approved on the computer." });
    writeJson(trustKey(link.uid), { ...readJson(trustKey(link.uid)),
      [from]: { id: from, label, kind, key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, pairedAt: Date.now() } });
    await reply(link, from, body.id, 1, "result", { host });
  } finally {
    pairing = false;
  }
}
