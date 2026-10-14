import { afterEach, beforeEach, expect, it, vi } from "vitest";

// One in-memory Realtime server: channels on a topic hear each other's broadcasts
// (never their own) and share presence.
const bus = vi.hoisted(() => {
  type Handler = { type: string; event?: string; cb: (arg?: unknown) => void };
  type Fake = ReturnType<typeof make>;
  const channels: Fake[] = [];
  const presence: Record<string, unknown[]> = {};
  const state = { failJoins: 0 };
  const sync = () => channels.forEach(c => c.handlers.filter(h => h.type === "presence").forEach(h => h.cb()));
  function make(topic: string, opts: { config: { presence: { key: string } } }) {
    const ch = {
      topic,
      handlers: [] as Handler[],
      on(type: string, filter: { event?: string }, cb: (arg?: unknown) => void) { ch.handlers.push({ type, event: filter.event, cb }); return ch; },
      subscribe(cb: (status: string, error?: Error) => void = () => {}) {
        if (state.failJoins > 0) { state.failJoins--; queueMicrotask(() => cb("CHANNEL_ERROR", new Error("MissingPartition"))); return ch; }
        channels.push(ch); queueMicrotask(() => { cb("SUBSCRIBED"); sync(); }); return ch;
      },
      async track(meta: unknown) { presence[opts.config.presence.key] = [meta]; sync(); return "ok"; },
      presenceState: () => ({ ...presence }),
      async send(msg: { event: string; payload: unknown }) {
        for (const other of channels) if (other !== ch && other.topic === topic)
          other.handlers.filter(h => h.type === "broadcast" && h.event === msg.event).forEach(h => h.cb({ payload: msg.payload }));
        return "ok";
      },
    };
    return ch;
  }
  return { channels, presence, make, state, reset() { channels.length = 0; state.failJoins = 0; for (const k of Object.keys(presence)) delete presence[k]; } };
});
const session = { user: { id: "owner" }, access_token: "token" };
vi.mock("../supabase", () => ({
  supabase: {
    realtime: { setAuth: async () => {} },
    channel: bus.make,
    removeChannel: async (c: unknown) => { bus.channels.splice(bus.channels.indexOf(c as never), 1); },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        queueMicrotask(() => cb("INITIAL_SESSION", session));
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));
vi.mock("../dataMode", () => ({ effectiveDataMode: () => "cloud" }));
vi.mock("../nativePlatform", () => ({ isNativeApp: () => false }));

const TOPIC = "filey-link:owner";
/** Long enough for a dropped request to have been answered if it were going to be. */
const quiet = () => new Promise(r => setTimeout(r, 150));
const last = <T,>(items: T[]) => items[items.length - 1];
const until = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 10 });
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

/** A second device on the bus, speaking the wire protocol by hand. */
async function device(id: string, meta: Record<string, unknown> = { id, label: "iPhone", kind: "mobile", host: false }) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const ch = bus.make(TOPIC, { config: { presence: { key: id } } });
  const replies: { re: string; seq: number; type: string; data?: any }[] = [];
  const requests: { from: string; body: any }[] = [];
  ch.on("broadcast", { event: "res" }, a => { const p = (a as { payload: any }).payload; if (p.to === id) replies.push(p); });
  ch.on("broadcast", { event: "req" }, a => { const p = (a as { payload: any }).payload; if (p.to === id) requests.push({ from: p.from, body: JSON.parse(p.body) }); });
  ch.subscribe();
  await ch.track({ ...meta, since: 1 });
  const sign = async (body: unknown) => {
    const text = JSON.stringify(body);
    return { from: id, body: text, sig: b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, enc(text))) };
  };
  return {
    key: { kty, crv, x, y }, replies, requests,
    async request(to: string, method: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
      const body = { id: crypto.randomUUID(), from: id, to, method, params, ts: Date.now(), ...extra };
      const env = { ...(await sign(body)), to };
      await ch.send({ event: "req", payload: env });
      return { body, env, mine: () => replies.filter(r => r.re === body.id) };
    },
    async raw(env: unknown) { await ch.send({ event: "req", payload: env }); },
    reply: (to: string, re: string, seq: number, type: string, data?: unknown) =>
      ch.send({ event: "res", payload: { to, re, seq, type, data } }),
  };
}

beforeEach(() => { bus.reset(); localStorage.clear(); vi.resetModules(); });
afterEach(() => Reflect.deleteProperty(window, "__TAURI_INTERNALS__"));

it("desktop: pairs after approval, then runs only fresh, signed, single-use requests from that device", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const link = await import("../deviceLink");
  const approvals: { label: string; code: string }[] = [];
  link.setPairApprover(async request => { approvals.push(request); return true; });
  link.registerLinkMethod("echo", async (params, call) => {
    await call.emit("event", { type: "text", text: "working" });
    return { approved: await call.ask("send_whatsapp", { to: "971" }), got: params.x };
  });
  link.startDeviceLink();
  const host = link.thisDeviceId();
  await until(() => expect(bus.presence[host]).toBeDefined());
  const phone = await device("phone-1");

  // Not paired yet: refused without running anything.
  const early = await phone.request(host, "echo", { x: 1 });
  await until(() => expect(early.mine()).toEqual([expect.objectContaining({ type: "error", data: expect.objectContaining({ code: "not_paired" }) })]));

  const paired = await phone.request(host, "pair", { label: "iPhone", kind: "mobile", key: phone.key });
  await until(() => expect(paired.mine().map(r => r.type)).toEqual(["accepted", "result"]));
  expect(approvals).toEqual([expect.objectContaining({ label: "iPhone", code: await link.pairingCode(phone.key) })]);
  expect(link.trustedDevices().map(d => d.id)).toEqual(["phone-1"]);

  const call = await phone.request(host, "echo", { x: 5 });
  await until(() => expect(call.mine().map(r => r.type)).toEqual(["accepted", "event", "confirm"]));
  const confirm = call.mine().find(r => r.type === "confirm")!;
  expect(confirm.data).toEqual(expect.objectContaining({ name: "send_whatsapp" }));
  await phone.request(host, "answer", { cid: confirm.data.cid, ok: true }, { re: call.body.id });
  await until(() => expect(call.mine().map(r => r.type)).toEqual(["accepted", "event", "confirm", "result"]));
  expect(call.mine().map(r => r.seq)).toEqual([0, 1, 2, 3]);
  expect(last(call.mine())!.data).toEqual({ approved: true, got: 5 });

  // Replayed, tampered, stale and other-key requests are dropped.
  const before = phone.replies.length;
  await phone.raw(call.env);
  await phone.raw({ ...call.env, body: call.env.body.replace('"x":5', '"x":6') });
  await phone.request(host, "echo", { x: 7 }, { ts: Date.now() - 10 * 60_000 });
  const stranger = await device("phone-1-copy", { id: "phone-1-copy", label: "?", kind: "web", host: false });
  await stranger.raw({ ...(await (async () => { const b = { id: crypto.randomUUID(), from: "phone-1", to: host, method: "echo", params: { x: 8 }, ts: Date.now() }; return { from: "phone-1", body: JSON.stringify(b), sig: call.env.sig }; })()), to: host });
  await quiet();
  expect(phone.replies.length).toBe(before);

  link.forgetDevice("phone-1");
  const after = await phone.request(host, "echo", { x: 9 });
  await until(() => expect(after.mine()).toEqual([expect.objectContaining({ data: expect.objectContaining({ code: "not_paired" }) })]));
});

it("phone: pairs, runs a turn on the computer with approvals asked here, and falls back when it is busy", async () => {
  const link = await import("../deviceLink");
  const { linkedAgentTurn, preferLinked, viaDesktopOr } = await import("../linkedAgent");
  link.startDeviceLink();
  await until(() => expect(bus.presence[link.thisDeviceId()]).toBeDefined());
  const desktop = await device("desktop-1", { id: "desktop-1", label: "Windows computer", kind: "desktop", host: true, mode: "cloud" });
  expect(link.linkedHost()).toBeUndefined(); // open, but not paired

  const pairing = link.pairWith(link.linkedDevices()[0]);
  await until(() => expect(desktop.requests).toHaveLength(1));
  const pairReq = last(desktop.requests)!;
  expect(pairReq.body.params.key).toEqual((await link.deviceKeys()).publicKey);
  await desktop.reply(pairReq.from, pairReq.body.id, 0, "accepted");
  await desktop.reply(pairReq.from, pairReq.body.id, 1, "result", { host: { id: "desktop-1", label: "Windows computer" } });
  await pairing;
  expect(link.linkedHost()?.id).toBe("desktop-1");

  const confirm = vi.fn(async () => true);
  const ctl = new AbortController();
  const turn = linkedAgentTurn({ chatId: "c1", goalText: "Invoice ACME 500", history: [], auto: false }, { confirm, signal: ctl.signal });
  const first = turn.next();
  await until(() => expect(desktop.requests).toHaveLength(2));
  const req = last(desktop.requests)!;
  expect(req.body).toEqual(expect.objectContaining({ method: "agent.turn", params: expect.objectContaining({ goalText: "Invoice ACME 500" }) }));
  await desktop.reply(req.from, req.body.id, 0, "accepted");
  await desktop.reply(req.from, req.body.id, 1, "event", { type: "tool_call", id: "1", name: "create_invoice_draft", args: {} });
  expect((await first).value).toEqual(expect.objectContaining({ type: "tool_call", name: "create_invoice_draft" }));
  // Out of order on the wire, in order for the chat.
  await desktop.reply(req.from, req.body.id, 3, "result", { text: "Draft INV-7 saved.", files: [] });
  await desktop.reply(req.from, req.body.id, 2, "confirm", { cid: "k1", name: "send_invoice", args: { invoice_number: "INV-7" } });
  const done = turn.next();
  await until(() => expect(desktop.requests).toHaveLength(3));
  expect(confirm).toHaveBeenCalledWith("send_invoice", { invoice_number: "INV-7" });
  expect(last(desktop.requests)!.body).toEqual(expect.objectContaining({ method: "answer", re: req.body.id, params: { cid: "k1", ok: true } }));
  expect(await done).toEqual({ done: true, value: "Draft INV-7 saved." });

  // A busy computer never took the turn: this device answers instead.
  // eslint-disable-next-line require-yield
  const local = vi.fn(async function* () { return "answered here"; });
  const fallback = preferLinked(() => linkedAgentTurn({ chatId: "c2", goalText: "hi", history: [], auto: false }, { confirm, signal: ctl.signal }), local);
  const answer = fallback.next();
  await until(() => expect(desktop.requests).toHaveLength(4));
  const busy = last(desktop.requests)!;
  await desktop.reply(busy.from, busy.body.id, 0, "error", { message: "Your computer is busy with other requests.", code: "busy" });
  expect(await answer).toEqual({ done: true, value: "answered here" });

  link.forgetHost("desktop-1");
  expect(await viaDesktopOr("send_whatsapp", { to: "1", text: "x" }, undefined, "WhatsApp runs in the desktop app only."))
    .toEqual({ error: "WhatsApp runs in the desktop app only.", hint: expect.stringContaining("Linked devices") });
});

it("joins again by itself when Realtime refuses the first join", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    bus.state.failJoins = 1;
    const link = await import("../deviceLink");
    link.startDeviceLink();
    await vi.advanceTimersByTimeAsync(1);
    expect(bus.presence[link.thisDeviceId()]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bus.presence[link.thisDeviceId()]).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});
