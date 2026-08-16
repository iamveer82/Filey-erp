#!/usr/bin/env node
/*
 * Filey — WhatsApp bridge (QR pairing, local agent, no server).
 *
 * WHY A SEPARATE PROCESS
 * A QR session is a long-lived socket with rolling auth state, so it runs as a
 * sidecar the desktop app starts and outlives. It is dumb transport only: it
 * forwards each message to the LOCAL Filey agent (the app's own brain, over
 * stdin/stdout) and speaks the reply it gets back. No Supabase, no webhook
 * URL, no server — the agent, its memory and every tool run in the app.
 *
 * THE TRADE-OFF, STATED PLAINLY
 * This drives a real WhatsApp account through an unofficial library. It is
 * against WhatsApp's Terms of Service and the number CAN be banned. Use a
 * number you can afford to lose, and don't point it at bulk messaging — one
 * owner, one assistant, low volume.
 *
 * SETUP
 *   cd tools/wa-bridge && npm install && npm start
 *   → scan the QR with WhatsApp → Linked devices
 *
 * Auth state is written to the session dir the app passes (or ./auth here) —
 * that folder IS the login. Anyone holding it can message as you, so keep it
 * off shared drives and out of git.
 */
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import QR from "qrcode";

/** One JSON object per line on stdout. The desktop app parses these to show
 *  the QR/state and to route messages to the local agent. Keep it one-line —
 *  the Rust side reads line by line. */
const emit = (obj) => console.log("FILEY " + JSON.stringify(obj));

/** Plain text out of the many shapes a WhatsApp message can arrive in. */
function textOf(m) {
  const c = m.message ?? {};
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    ""
  ).trim();
}

/** Replies arrive on stdin as `FILEY {"type":"reply","id":...,"text":...}`.
 *  Each outstanding message awaits its reply by id; anything else is ignored. */
const pending = new Map(); // id -> { resolve, timer, ackTimer, jid, timedOut }
/** One agent turn can be several LLM calls, and the desktop AI proxy allows
 *  180s per call — two minutes was short enough that a real piece of work
 *  (look up the customer, price the lines, draft the invoice) blew through it,
 *  and the answer that arrived afterwards was thrown away. */
const REPLY_TIMEOUT_MS = 240_000;
/** Silence reads as "it's broken", so say something while the agent works. */
const ACK_AFTER_MS = 20_000;
/** The app's replies open with this line (waFormat in src/lib/waAgent.ts); the
 *  bridge's own messages wear it too so everything from Filey looks the same. */
const HEADER = "*⚡ Filey Agent*";

/** The live socket (set in start()); the stdin `send` handler uses it for
 *  proactive owner notifications. */
let activeSock = null;

/** Message ids this bridge sent itself. In self-chat every outgoing message
 *  comes straight back through messages.upsert as fromMe on our own JID, so
 *  without this the agent answers its own replies forever.
 *  ponytail: bounded Set, oldest evicted — ids only need to survive the round
 *  trip (milliseconds). */
const sentIds = new Set();
function remember(id) {
  if (!id) return;
  sentIds.add(id);
  if (sentIds.size > 200) sentIds.delete(sentIds.values().next().value);
}

const digitsOf = (s) => (s ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Send on the live socket, remembering the id so our own message doesn't come
 *  back through messages.upsert as a new question. Never throws. */
async function sendTo(jid, text) {
  if (!jid || !text || !activeSock) return;
  try {
    remember((await activeSock.sendMessage(jid, { text }))?.key?.id);
  } catch (e) {
    console.error("send failed:", e?.message);
  }
}

function startStdinLoop() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const prefix = "FILEY ";
    if (!line.startsWith(prefix)) return;
    let v;
    try {
      v = JSON.parse(line.slice(prefix.length));
    } catch {
      return;
    }
    if (v.type === "reply") {
      const r = pending.get(v.id);
      if (r) {
        pending.delete(v.id);
        clearTimeout(r.timer);
        clearTimeout(r.ackTimer);
        // A late answer is still the answer: deliver it as its own message
        // instead of dropping it because a timer fired first.
        if (r.timedOut) void sendTo(r.jid, v.text ?? "");
        else r.resolve(v.text ?? "");
      }
    }
    if (v.type === "send") {
      // Proactive message to a specific JID (owner notifications). The desktop
      // app drives these after pairing; before that activeSock is null.
      void sendTo(v.to, v.text);
    }
  });
}

/** Send a message to the local agent and wait for its reply. Never throws.
 *  The entry survives its own timeout so a slow answer is still delivered. */
function askAgent(jid, from, text, fromName) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const entry = { resolve, jid, timedOut: false };
    entry.ackTimer = setTimeout(() => {
      if (pending.has(id)) void sendTo(jid, `${HEADER}\n\nOn it — working on that now…`);
    }, ACK_AFTER_MS);
    entry.timer = setTimeout(() => {
      entry.timedOut = true;
      // Stop holding this chat's turn, but keep the entry around a while: if
      // the app answers late, the reply handler sends it as its own message.
      setTimeout(() => pending.delete(id), 120_000).unref?.();
      resolve(
        `${HEADER}\n\nThe app didn't answer in time — make sure Filey is open and the WhatsApp bridge is connected. I'll send the answer if it still lands.`
      );
    }, REPLY_TIMEOUT_MS);
    pending.set(id, entry);
    emit({ type: "message", id, from, text, fromName });
  });
}

/** Reconnect ONCE per drop, on a fresh socket, with the dead one fully torn
 *  down first.
 *
 *  This used to call start() straight from the close handler. Nothing stopped
 *  the old socket, so every drop left another live socket behind, all sharing
 *  the same auth folder and all writing signal state: the phone ends up unable
 *  to decrypt what the stale session sends, and shows "Waiting for this
 *  message" where the reply should be. A flapping connection also meant the
 *  same incoming message was handled by several sockets at once. */
let reconnecting = false;
let backoffStep = 0;

function reconnect(dead) {
  try {
    // Stop it answering and stop it re-entering here — but NOT `creds.update`.
    // Baileys flushes credential updates (prekey counters, identity state) as
    // it shuts down, and those are saved by that listener while the signal keys
    // are written straight to disk by the auth state. Dropping the listener
    // first loses the creds half, so the folder ends up with keys newer than
    // the creds that index them — after which the phone cannot decrypt what we
    // send and shows "Waiting for this message". End first, unsubscribe after.
    dead?.ev?.removeAllListeners?.("messages.upsert");
    dead?.ev?.removeAllListeners?.("connection.update");
    dead?.end?.(undefined);
    setTimeout(() => dead?.ev?.removeAllListeners?.("creds.update"), 2_000).unref?.();
  } catch {
    // already gone
  }
  if (activeSock === dead) activeSock = null;
  if (reconnecting) return;
  reconnecting = true;
  const wait = Math.min(30_000, 2_000 * 2 ** backoffStep++);
  setTimeout(() => {
    reconnecting = false;
    start().catch((e) => console.error("reconnect failed:", e?.message));
  }, wait);
}

async function start() {
  // The session folder IS the login, so it must survive app updates and live
  // somewhere writable. The desktop app passes its per-user data dir; a human
  // running this from the repo gets ./auth next to the script.
  const authDir = process.env.FILEY_BRIDGE_STATE || path.join(process.cwd(), "auth");
  // Never two sockets on one auth folder. Both would write signal state and the
  // phone would stop being able to decrypt us; one live socket is the whole
  // invariant this file has to hold.
  if (activeSock) {
    const old = activeSock;
    activeSock = null;
    try {
      old.ev?.removeAllListeners?.("messages.upsert");
      old.ev?.removeAllListeners?.("connection.update");
      old.end?.(undefined);
    } catch {
      // already gone
    }
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });
  activeSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\nScan this in WhatsApp → Settings → Linked devices:\n");
      qrcode.generate(qr, { small: true });
      QR.toDataURL(qr, { margin: 1, width: 320 })
        .then((dataUrl) => emit({ type: "qr", dataUrl }))
        .catch((e) => console.error("qr encode failed:", e.message));
    }
    if (connection === "open") {
      backoffStep = 0;
      console.log("\n✅ Paired. Message this number from your own WhatsApp and the agent answers.\n");
      emit({ type: "status", state: "connected", me: sock.user?.id ?? null });
    }
    if (connection === "connecting") emit({ type: "status", state: "connecting" });
    if (connection === "close") {
      // 401 (loggedOut) means the phone unlinked us — reconnecting would spin
      // forever, so stop and make the human re-scan.
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out on the phone. Delete the session dir and run again to re-pair.");
        emit({ type: "status", state: "logged_out" });
        process.exit(1);
      }
      console.warn("Connection dropped — reconnecting…");
      emit({ type: "status", state: "reconnecting" });
      reconnect(sock);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const meDigits = digitsOf(sock.user?.id);
    for (const m of messages) {
      if (m.key.remoteJid?.endsWith("@g.us")) continue; // ignore group chats
      if (sentIds.has(m.key.id)) continue; // our own reply echoing back

      const jid = m.key.remoteJid;
      // fromMe is only for the agent in self-chat (your own Saved Messages
      // thread). Any other fromMe message is the owner typing to a real
      // contact — answering there would butt into their conversation.
      const selfChat = !!meDigits && digitsOf(jid) === meDigits;
      if (m.key.fromMe && !selfChat) continue;

      const text = textOf(m);
      if (!text) continue;

      const phone = (jid ?? "").split("@")[0];
      const name = m.pushName ?? phone;
      console.log(`← ${name}: ${text}`);

      const reply = await askAgent(jid, phone, text, name);
      if (!reply) continue;
      // Sent on the CURRENT socket, not the one this message arrived on: a
      // reconnect during a long agent run would otherwise send on a dead
      // session, which the phone shows as "Waiting for this message".
      await sendTo(jid, reply);
      console.log(`→ ${reply.slice(0, 120)}${reply.length > 120 ? "…" : ""}`);
    }
  });
}

startStdinLoop();
start().catch((e) => {
  console.error("bridge failed to start:", e);
  process.exit(1);
});
