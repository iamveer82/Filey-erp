/** Provider identities are not interchangeable: a LID's digits are not a phone. */
export function phoneNumber(value) {
  const raw = String(value ?? "").trim();
  if (raw.includes("@") && !/^\d+(?::\d+)?@s\.whatsapp\.net$/.test(raw)) return "";
  if (!raw.includes("@") && !/^\+?[\d ()-]+$/.test(raw)) return "";
  const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return /^\d{7,15}$/.test(digits) ? digits : "";
}

const normalizeJid = (jid) => String(jid ?? "").replace(/:\d+(?=@)/, "");

/** Only metadata supplied by WhatsApp can map an alternate ID to a phone.
 * Never infer ownership from message text, contact names or a company field. */
export function ownerIdentity(key, me, ownerNumber) {
  const jid = normalizeJid(key.remoteJid);
  if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) return null;
  const paired = phoneNumber(me?.id);
  const self = jid === normalizeJid(me?.id) || (!!me?.lid && jid === normalizeJid(me.lid));
  // An outgoing message to another person is not an agent command, even if
  // senderPn identifies the owner who typed it.
  if (key.fromMe && !self) return null;
  const phone = self ? paired : phoneNumber(jid) || phoneNumber(key.remoteJidAlt) || phoneNumber(key.senderPn);
  if (!phone || (phone !== paired && phone !== phoneNumber(ownerNumber))) return null;
  return { jid, phone };
}
