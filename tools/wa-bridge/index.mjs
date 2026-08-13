#!/usr/bin/env node
/*
 * Filey — WhatsApp bridge (QR pairing, no per-message cost).
 *
 * WHY THIS EXISTS
 * The Meta Cloud API charges per conversation and needs approved templates to
 * start one, which makes "chat with my own assistant" a metered activity. This
 * pairs by QR to a WhatsApp account you already own, so talking to your agent
 * is free.
 *
 * THE TRADE-OFF, STATED PLAINLY
 * This drives a real WhatsApp account through an unofficial library. It is
 * against WhatsApp's Terms of Service and the number CAN be banned. Use a
 * number you can afford to lose, and don't point it at bulk messaging — one
 * owner, one assistant, low volume.
 *
 * WHY A SEPARATE PROCESS
 * A QR session is a long-lived socket with rolling auth state. Supabase edge
 * functions are stateless and die between requests, so the session has to live
 * on a machine you control. This process is dumb transport: it forwards each
 * message to channel-webhook and speaks the reply it gets back. The agent, its
 * memory, and every approval gate stay server-side — nothing about the brain is
 * duplicated here.
 *
 * SETUP
 *   cd tools/wa-bridge && npm install
 *   set FILEY_WEBHOOK_URL=https://<ref>.functions.supabase.co/channel-webhook
 *   set FILEY_BRIDGE_SECRET=<same value as the WA_BRIDGE_SECRET function secret>
 *   npm start          → scan the QR with WhatsApp → Linked devices
 *
 * Auth state is written to ./auth/ — that folder IS the login. Anyone holding
 * it can message as you, so keep it off shared drives and out of git.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import QR from "qrcode";

/** One JSON object per line on stdout. The desktop app parses these to show
 *  the QR and connection state in the Integrations page; a human running this
 *  in a terminal gets the pretty output below instead. Keep it one-line — the
 *  Rust side reads line by line. */
const emit = (obj) => console.log("FILEY " + JSON.stringify(obj));

const HERE = path.dirname(fileURLToPath(import.meta.url));

const WEBHOOK = process.env.FILEY_WEBHOOK_URL;
const SECRET = process.env.FILEY_BRIDGE_SECRET;
if (!WEBHOOK || !SECRET) {
  console.error(
    "Set FILEY_WEBHOOK_URL and FILEY_BRIDGE_SECRET first.\n" +
      "  FILEY_WEBHOOK_URL   = https://<project-ref>.functions.supabase.co/channel-webhook\n" +
      "  FILEY_BRIDGE_SECRET = the WA_BRIDGE_SECRET you set on the function"
  );
  process.exit(1);
}

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

/** Ask the agent. Never throws: a bridge that dies on a bad reply is worse
 *  than one that says so and keeps the session up. */
async function askAgent(from, text, fromName) {
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-secret": SECRET },
      body: JSON.stringify({ from, text, fromName }),
    });
    if (!res.ok) {
      console.error("webhook", res.status, await res.text().catch(() => ""));
      return res.status === 403
        ? "The bridge secret is wrong — check WA_BRIDGE_SECRET."
        : "The assistant is unreachable right now.";
    }
    const body = await res.json().catch(() => null);
    return body?.reply ?? "";
  } catch (e) {
    console.error("webhook call failed:", e.message);
    return "The assistant is unreachable right now.";
  }
}

async function start() {
  // The session folder IS the login, so it must survive app updates and live
  // somewhere writable. The desktop app passes its per-user data dir; a human
  // running this from the repo gets ./auth next to the script.
  const authDir = process.env.FILEY_BRIDGE_STATE || path.join(HERE, "auth");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\nScan this in WhatsApp → Settings → Linked devices:\n");
      qrcode.generate(qr, { small: true });
      // Same code as a PNG data URL, so the app can render it without pulling
      // a QR library into the frontend bundle.
      QR.toDataURL(qr, { margin: 1, width: 320 })
        .then((dataUrl) => emit({ type: "qr", dataUrl }))
        .catch((e) => console.error("qr encode failed:", e.message));
    }
    if (connection === "open") {
      console.log("\n✅ Paired. Message this number from your own WhatsApp and the agent answers.\n");
      emit({ type: "status", state: "connected" });
    }
    if (connection === "connecting") emit({ type: "status", state: "connecting" });
    if (connection === "close") {
      // 401 (loggedOut) means the phone unlinked us — reconnecting would spin
      // forever, so stop and make the human re-scan.
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out on the phone. Delete ./auth and run again to re-pair.");
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
    for (const m of messages) {
      // fromMe covers the "chat with myself" case: talking to your own agent in
      // your own Saved Messages thread should still work.
      if (m.key.remoteJid?.endsWith("@g.us")) continue; // ignore group chats
      const text = textOf(m);
      if (!text) continue;

      const jid = m.key.remoteJid;
      const phone = (jid ?? "").split("@")[0];
      const name = m.pushName ?? phone;
      console.log(`← ${name}: ${text}`);

      const reply = await askAgent(phone, text, name);
      if (!reply) continue;
      await sock.sendMessage(jid, { text: reply });
      console.log(`→ ${reply.slice(0, 120)}${reply.length > 120 ? "…" : ""}`);
    }
  });
}

start().catch((e) => {
  console.error("bridge failed to start:", e);
  process.exit(1);
});
