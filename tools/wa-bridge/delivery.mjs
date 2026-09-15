import fs from "node:fs/promises";
import path from "node:path";

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
    const data = await fs.readFile(command.path);
    const mime = command.mimetype || "application/octet-stream";
    content = mime.startsWith("image/")
      ? { image: data, caption: command.caption || undefined }
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
  const result = await socket.sendMessage(jid, content);
  if (!result?.key?.id)
    throw new Error(
      "WhatsApp did not confirm acceptance. Check the chat before retrying."
    );
  remember(result.key.id);
  return result.key.id;
}
