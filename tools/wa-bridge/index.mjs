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
const pending = new Map(); // id -> resolve(text)
const REPLY_TIMEOUT_MS = 120_000;

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
        r.resolve(v.text ?? "");
      }
    }
    if (v.type === "send") {
      // Proactive message to a specific JID (owner notifications). The desktop
      // app drives these after pairing; before that activeSock is null.
      if (v.to && v.text && activeSock) {
        activeSock
          .sendMessage(v.to, { text: v.text })
          .then((s) => remember(s?.key?.id))
          .catch((e) => console.error("send failed:", e?.message));
      }
    }
  });
}

/** Send a message to the local agent and wait for its reply. Never throws. */
function askAgent(from, text, fromName) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve("The app didn't answer in time — make sure Filey is open and the WhatsApp bridge is running.");
    }, REPLY_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    emit({ type: "message", id, from, text, fromName });
  });
}

async function start() {
  // The session folder IS the login, so it must survive app updates and live
  // somewhere writable. The desktop app passes its per-user data dir; a human
  // running this from the repo gets ./auth next to the script.
  const authDir = process.env.FILEY_BRIDGE_STATE || path.join(process.cwd(), "auth");
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
      start();
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

      const reply = await askAgent(phone, text, name);
      if (!reply) continue;
      remember((await sock.sendMessage(jid, { text: reply }))?.key?.id);
      console.log(`→ ${reply.slice(0, 120)}${reply.length > 120 ? "…" : ""}`);
    }
  });
}

startStdinLoop();
start().catch((e) => {
  console.error("bridge failed to start:", e);
  process.exit(1);
});
