import fs from "node:fs/promises";
import path from "node:path";
import { generateMessageIDV2 } from "@whiskeysockets/baileys";

/** Resolve only when WhatsApp accepts the message. Never retry ambiguous sends. */
export async function sendConfirmed(socket, command, remember = () => {}) {
  if (!socket?.sendMessage)
    throw new Error("WhatsApp is disconnected. Reconnect before sending.");
  const to = String(command.to ?? "").trim();
  if (!/^\d+(?::\d+)?(?:@s\.whatsapp\.net|@lid)?$/.test(to))
    throw new Error("Use a valid individual WhatsApp recipient.");
  const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  let content;
  if (command.type === "send_file") {
    const size = await fs.stat(command.path);
    if (!size.isFile() || size.size < 1 || size.size > 50 * 1024 * 1024)
      throw new Error("Choose a non-empty file smaller than 50 MB.");
    const data = await fs.readFile(command.path);
    if (!data.length || data.length > 50 * 1024 * 1024) throw new Error("File size changed before upload.");
    const known = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".csv": "text/csv", ".txt": "text/plain", ".zip": "application/zip" };
    const mime = command.mimetype || known[path.extname(command.filename || command.path).toLowerCase()] || "application/octet-stream";
    content = mime.startsWith("image/")
      ? { image: data, caption: command.caption || undefined }
      : mime.startsWith("video/") ? { video: data, mimetype: mime, caption: command.caption || undefined }
      : mime.startsWith("audio/")
        ? { audio: data, mimetype: mime, ptt: mime.includes("ogg") }
        : {
            document: data,
            mimetype: mime,
            fileName: command.filename || path.basename(command.path),
            caption: command.caption || undefined,
          };
  } else {
    if (typeof command.text !== "string" || !command.text.trim())
      throw new Error("Message is empty.");
    content = { text: command.text };
  }
  const messageId = generateMessageIDV2(socket.user?.id);
  // Self-chat echoes can arrive before sendMessage resolves. Register the ID
  // first so Filey never treats its own answer as another owner command.
  remember(messageId);
  const result = await socket.sendMessage(jid, content, { messageId });
  if (!result?.key?.id)
    throw new Error(
      "WhatsApp did not confirm acceptance. Check the chat before retrying."
    );
  remember(result.key.id, result.message);
  return result.key.id;
}
