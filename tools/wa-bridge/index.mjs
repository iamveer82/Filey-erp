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
import crypto from "node:crypto";
import readline from "node:readline";
import { sendConfirmed } from "./delivery.mjs";
import { ownerIdentity, phoneNumber } from "./identity.mjs";
import { bridgeLaunch } from "./launch.mjs";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import QR from "qrcode";

// Pairing keys are private to this OS user on platforms with POSIX permissions.
process.umask(0o077);
const { stateDir, ownerNumber } = bridgeLaunch();
// Self-chat arrives as append too. Only accept live entries from this process
// lifetime; synchronized history must never execute old business requests.
const startedAtSeconds = Math.floor(Date.now() / 1000);

/** One JSON object per line on stdout. The desktop app parses these to show
 *  the QR/state and to route messages to the local agent. Keep it one-line —
 *  the Rust side reads line by line. */
const emit = (obj) => console.log("FILEY " + JSON.stringify(obj));

/** Plain text out of the many shapes a WhatsApp message can arrive in. */
function textOf(m) {
  const c = normalizeMessageContent(m.message) ?? {};
  const text = (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    ""
  );
  return typeof text === "string" ? text.trim() : "";
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
 *  bridge's own messages wear it too so everything from Filey looks the same.
 *  Bold + underlined: WhatsApp has no underline markup, so each letter carries
 *  the combining low line (U+0332) — how underlined text is typed on WhatsApp. */
const underline = (s) => [...s].map((c) => (c === " " ? c : c + "\u0332")).join("");
const HEADER = `*${underline("Filey Agent")}*`;

/** The live socket (set in start()); the stdin `send` handler uses it for
 *  proactive owner notifications. */
let activeSock = null;
let connected = false;
let closing = false;
let qrGeneration = 0;

/** Message ids this bridge sent itself. In self-chat every outgoing message
 *  comes straight back through messages.upsert as fromMe on our own JID, so
 *  without this the agent answers its own replies forever.
 *  ponytail: bounded Set, oldest evicted — ids only need to survive the round
 *  trip (milliseconds). */
const sentIds = new Set();
const sentMessages = new Map();
// Bounded replay window across reconnects; provider re-delivery must not repeat a tool.
const receivedIds = new Set();
function remember(id, message) {
  if (!id) return;
  sentIds.add(id);
  if (message) sentMessages.set(id, message);
  if (sentIds.size > 200) {
    const oldest = sentIds.values().next().value;
    sentIds.delete(oldest);
    sentMessages.delete(oldest);
  }
}

/** Send on the live socket, remembering the id so our own message doesn't come
 *  back through messages.upsert as a new question. Never throws. */
async function sendTo(jid, text) {
  if (!jid || !text || !activeSock) return;
  try {
    await sendConfirmed(connected ? activeSock : null, { to: jid, text }, remember);
  } catch (e) {
    console.error("send failed:", e?.message);
  }
}

/** Acknowledgment flows back through Rust; writing stdin alone is not delivery. */
async function deliver(command) {
  try {
    // Empty replies deliberately release non-owner chats without sending anything.
    const skipped = command.type === "reply" && !command.text;
    const messageId = skipped ? null : await sendConfirmed(connected ? activeSock : null, command, remember);
    if (command.requestId)
      emit({ type: "delivery", requestId: command.requestId, ok: true, messageId, skipped });
  } catch (e) {
    if (command.requestId)
      emit({
        type: "delivery",
        requestId: command.requestId,
        ok: false,
        error: e?.message || "WhatsApp did not confirm delivery.",
      });
    else console.error("send failed:", e?.message);
  }
}

function startStdinLoop() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  // Parent exit closes stdin. Do not leave a socket without the owner gate.
  rl.on("close", async () => {
    closing = true;
    connected = false;
    qrGeneration++;
    try { activeSock?.end?.(undefined); } catch { /* already closed */ }
    await credentialWrites;
    process.exit(0);
  });
  rl.on("line", (line) => {
    const prefix = "FILEY ";
    if (!line.startsWith(prefix)) return;
    let v;
    try {
      v = JSON.parse(line.slice(prefix.length));
    } catch {
      return;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    if (v.type === "reply") {
      const r = pending.get(v.id);
      if (r) {
        pending.delete(v.id);
        clearTimeout(r.timer);
        clearTimeout(r.ackTimer);
        // A late answer is still the answer: deliver it as its own message
        // instead of dropping it because a timer fired first.
        const reply = { ...v, to: r.jid, text: v.text ?? "" };
        if (r.timedOut) void deliver(reply);
        else r.resolve(reply);
      } else if (v.requestId) {
        emit({
          type: "delivery",
          requestId: v.requestId,
          ok: false,
          error:
            "This WhatsApp request expired. Check the conversation before trying again.",
        });
      }
    }
    if (v.type === "send") {
      // Proactive message to a specific JID (owner notifications). The desktop
      // app drives these after pairing; before that activeSock is null.
      void deliver(v);
    }
    if (v.type === "send_file") {
      // A PDF, photo or document the agent produced, delivered into the chat.
      // The app passes an absolute path; the file is read here so multi-MB
      // payloads never cross the stdin pipe.
      void deliver(v);
    }
  });
}

/** Send a message to the local agent and wait for its reply. Never throws.
 *  The entry survives its own timeout so a slow answer is still delivered. */
function askAgent(jid, from, text, fromName, attachment) {
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
      resolve({
        to: jid,
        text: `${HEADER}\n\nThe app didn't answer in time — make sure Filey is open and the WhatsApp bridge is connected. I'll send the answer if it still lands.`,
      });
    }, REPLY_TIMEOUT_MS);
    pending.set(id, entry);
    emit({ type: "message", id, from, text, fromName, chatJid: jid, ...(attachment ? { attachment } : {}) });
  });
}

async function downloadLimited(message, limit) {
  const stream = await downloadMediaMessage(message, "stream", {});
  const timer = setTimeout(() => stream.destroy(new Error("Attachment download timed out")), 30_000);
  timer.unref?.();
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) throw new Error("Attachment exceeds its size limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); stream.destroy?.(); }
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
let credentialWrites = Promise.resolve();
let startupStage = "pairing";

/** Safe support details only: provider exceptions may contain pairing material. */
function startupFailure(error) {
  const codes = ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "ENOMEM", "ENOSPC", "EMFILE", "ENFILE", "EBUSY", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_INVALID_URL", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED", "ERR_WORKER_INIT_FAILED"];
  const names = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "Error"];
  const detail = codes.includes(error?.code) ? error.code : names.includes(error?.name) ? error.name : "Error";
  return { type: "status", state: "error", error: `WhatsApp bridge could not start (${startupStage}: ${detail}). Close Filey and reconnect.` };
}

function reconnect(dead) {
  if (closing) return;
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
  } catch {
    // already gone
  }
  if (activeSock === dead) activeSock = null;
  connected = false;
  if (reconnecting) return;
  reconnecting = true;
  const wait = Math.min(30_000, 2_000 * 2 ** backoffStep++);
  setTimeout(async () => {
    await credentialWrites;
    if (closing) return;
    dead?.ev?.removeAllListeners?.("creds.update");
    reconnecting = false;
    start().catch((e) => {
      emit(startupFailure(e));
      reconnect(activeSock);
    });
  }, wait);
}

async function start() {
  if (closing) return;
  // The session folder IS the login, so it must survive app updates and live
  // somewhere writable. The desktop app passes its per-user data dir; a human
  // running this from the repo gets ./auth next to the script.
  const authDir = stateDir;
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
  startupStage = "pairing";
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  if (closing) return;
  // Signal keys and credentials belong to the same session. A reconnect must
  // wait for both, not just creds.json, before opening the replacement socket.
  const writeKeys = state.keys.set;
  const persist = (write) => {
    const result = credentialWrites.then(write);
    credentialWrites = result.catch(() => {
      closing = true;
      connected = false;
      emit({ type: "status", state: "error", error: "WhatsApp could not save its pairing. Check free disk space, then reconnect." });
      activeSock?.end?.(undefined);
    });
    return result;
  };
  state.keys.set = (data) => persist(() => writeKeys(data));
  startupStage = "socket";
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    // WhatsApp asks for the original payload when a receiving device could
    // not decrypt it. Without this callback it stays "Waiting for message".
    getMessage: async (key) => sentMessages.get(key.id),
  });
  activeSock = sock;
  connected = false;
  startupStage = "listeners";

  sock.ev.on("creds.update", () => {
    void persist(saveCreds).catch(() => {});
  });

  sock.ev.on("connection.update", (u) => {
    if (closing || sock !== activeSock) return;
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      const generation = ++qrGeneration;
      // QR contents grant account access. Show them only in the pairing UI.
      QR.toDataURL(qr, { margin: 1, width: 320 })
        .then((dataUrl) => { if (!closing && generation === qrGeneration && activeSock === sock && !connected) emit({ type: "qr", dataUrl }); })
        .catch((e) => console.error("qr encode failed:", e.message));
    }
    if (connection === "open") {
      qrGeneration++;
      connected = true;
      backoffStep = 0;
      console.log(
        "\n✅ Paired. Message this number from your own WhatsApp and the agent answers.\n"
      );
      emit({ type: "status", state: "connected", me: sock.user?.id ?? null });
    }
    if (connection === "connecting") emit({ type: "status", state: "connecting" });
    if (connection === "close") {
      connected = false;
      // 401 (loggedOut) means the phone unlinked us — reconnecting would spin
      // forever, so stop and make the human re-scan.
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error(
          "Logged out on the phone. Delete the session dir and run again to re-pair."
        );
        emit({ type: "status", state: "logged_out" });
        process.exit(1);
        return;
      }
      if ([DisconnectReason.badSession, DisconnectReason.multideviceMismatch, DisconnectReason.forbidden, DisconnectReason.connectionReplaced].filter(Boolean).includes(code)) {
        emit({ type: "status", state: "error", error: "WhatsApp rejected this session. Close other Filey instances, then reconnect or re-pair in Integrations." });
        process.exit(1);
        return;
      }
      console.warn("Connection dropped — reconnecting…");
      emit({ type: "status", state: "reconnecting" });
      reconnect(sock);
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    if (!event || !Array.isArray(event.messages)) return;
    const { messages, type } = event;
    if (type !== "notify" && type !== "append") return;
    for (const m of messages) {
      if (closing || sock !== activeSock || !connected) return;
      if (!m?.key || typeof m.key.remoteJid !== "string" || typeof m.key.id !== "string" || !m.key.id) continue;
      if (m.key.remoteJid.endsWith("@g.us")) continue; // ignore group chats
      if (sentIds.has(m.key.id)) continue; // our own reply echoing back

      const identity = ownerIdentity(m.key, sock.user, ownerNumber);
      // Reject strangers before downloading audio, queuing a turn or sending
      // the bridge's automatic acknowledgement/timeout messages.
      if (!identity) continue;
      const { jid, phone } = identity;

      if (type === "append") {
        const timestamp = Number(m.messageTimestamp);
        if (!m.key.fromMe || phone !== phoneNumber(sock.user?.id) ||
            !Number.isFinite(timestamp) || timestamp < startedAtSeconds ||
            timestamp > Math.floor(Date.now() / 1000) + 60) continue;
      }

      const text = textOf(m);
      // IDs protect current sends; the marker also protects restored self-chat
      // answers whose IDs are no longer in the bounded in-memory set.
      if (m.key.fromMe && text.startsWith(HEADER)) continue;

      // WhatsApp may re-deliver a message using its phone JID and its LID.
      // Both are the same authenticated owner and must execute only once.
      const receivedId = `${phone}:${m.key.id}`;
      if (receivedIds.has(receivedId)) continue;
      receivedIds.add(receivedId);
      if (receivedIds.size > 1000) receivedIds.delete(receivedIds.values().next().value);

      const name = m.pushName ?? phone;

      const content = normalizeMessageContent(m.message) ?? {};
      const document = content.documentMessage || content.imageMessage;
      if (document) {
        // Only authenticated owner media is downloaded. Bound the stream even
        // when provider metadata is absent or incorrect.
        if (Number(document.fileLength) > 12 * 1024 * 1024) {
          await sendTo(jid, `${HEADER}\n\nSend a PDF or image smaller than 12 MB.`);
          continue;
        }
        try {
          const bytes = await downloadLimited(m, 12 * 1024 * 1024);
          if (closing || !connected || sock !== activeSock) continue;
          // eslint-disable-next-line no-control-regex -- Strip control bytes from an untrusted filename.
          const filename = String(document.fileName || (content.imageMessage ? "photo.jpg" : "document.pdf")).split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, "").slice(0, 160);
          void askAgent(jid, phone, text || "Tell me what is in this attachment.", name, {
            name: filename || "attachment", mimetype: document.mimetype || "application/octet-stream", b64: bytes.toString("base64"),
          }).then(deliver);
        } catch { await sendTo(jid, `${HEADER}\n\nI couldn't download that file. Send it again as a document under 12 MB.`); }
        continue;
      }
      if (!text) {
        // Voice notes are speech, not silence: hand the audio to the app for
        // transcription. The note registers a pending entry exactly like a
        // typed message — the app's reply arrives as `reply` against the same
        // id, and without that entry the reply was written to nobody and the
        // owner sat staring at a read bubble that never answered. Capped: a
        // 40-minute voice memo is not a prompt.
        const audio = normalizeMessageContent(m.message)?.audioMessage;
        if (audio) {
          if (Number(audio.fileLength) > 8 * 1024 * 1024 || Number(audio.seconds) > 300) continue;
          try {
            const buf = await downloadLimited(m, 8 * 1024 * 1024);
            if (closing || !connected || sock !== activeSock) continue;
            if (buf && buf.length <= 8 * 1024 * 1024) {
              const id = crypto.randomUUID();
              void new Promise((resolve) => {
                const entry = { resolve, jid, timedOut: false };
                entry.ackTimer = setTimeout(() => {
                  if (pending.has(id))
                    void sendTo(jid, `${HEADER}\n\nOn it — working on that now…`);
                }, ACK_AFTER_MS);
                entry.timer = setTimeout(() => {
                  entry.timedOut = true;
                  setTimeout(() => pending.delete(id), 120_000).unref?.();
                  resolve({
                    to: jid,
                    text: `${HEADER}\n\nThe app didn't answer in time — make sure Filey is open and the WhatsApp bridge is connected.`,
                  });
                }, REPLY_TIMEOUT_MS);
                pending.set(id, entry);
                emit({
                  type: "voice_note",
                  id,
                  from: phone,
                  fromName: name,
                  chatJid: jid,
                  b64: buf.toString("base64"),
                  mimetype: audio.mimetype || "audio/ogg; codecs=opus",
                });
              }).then((reply) => {
                void deliver(reply);
              });
            } else {
              console.error("voice note too large, skipped");
            }
          } catch (e) {
            console.error("voice download failed:", e?.message);
          }
        }
        continue;
      }

      // Don't hold the provider event loop while a model works. The desktop
      // serializes turns; the bridge still receives disconnects and new inputs.
      void askAgent(jid, phone, text, name).then(deliver);
      // Sent on the CURRENT socket, not the one this message arrived on: a
      // reconnect during a long agent run would otherwise send on a dead
      // session, which the phone shows as "Waiting for this message".
    }
  });
}

startStdinLoop();
start().catch((e) => {
  emit(startupFailure(e));
  process.exit(1);
});
