import { ingestChannelMessage } from "./agentChannels";

export async function queueWhatsAppMessage(params: {
  externalId: string;
  userId: string;
  companyId?: string;
  text: string;
  dedupeKey: string;
}) {
  return ingestChannelMessage(
    { source: "whatsapp", externalId: params.externalId, userId: params.userId, companyId: params.companyId, text: params.text, dedupeKey: params.dedupeKey },
    params.userId,
  );
}