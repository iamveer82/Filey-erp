import { expect, it } from "vitest";
import { ownerIdentity, phoneNumber } from "./identity.mjs";

it("uses only provider phone metadata for a configured owner's alternate identity", () => {
  const me = { id: "971500000001:2@s.whatsapp.net", lid: "999999999999@lid" };
  expect(ownerIdentity({ remoteJid: "888888888888@lid", senderPn: "971500000002@s.whatsapp.net" }, me, "+971 50 000 0002"))
    .toEqual({ jid: "888888888888@lid", phone: "971500000002" });
  expect(ownerIdentity({ remoteJid: "888888888888@lid", remoteJidAlt: "971500000002@s.whatsapp.net" }, me, "971500000002"))
    .toEqual({ jid: "888888888888@lid", phone: "971500000002" });
  expect(ownerIdentity({ remoteJid: "888888888888@lid" }, me, "888888888888")).toBeNull();
  expect(ownerIdentity({ remoteJid: "971500000002@g.us", senderPn: "971500000002@s.whatsapp.net" }, me, "971500000002")).toBeNull();
  expect(phoneNumber("971500000001@lid")).toBe("");
  expect(phoneNumber("abc971500000001")).toBe("");
});
