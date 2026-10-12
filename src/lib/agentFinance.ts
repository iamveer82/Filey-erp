import { ingestChannelMessage } from "./agentChannels";

export async function queueFinanceTurn(params: {
  userId: string;
  companyId?: string;
  message: string;
  dedupeKey: string;
}) {
  return ingestChannelMessage(
    {
      source: "app",
      externalId: params.dedupeKey,
      userId: params.userId,
      companyId: params.companyId,
      text: params.message,
      dedupeKey: params.dedupeKey,
    },
    params.userId,
  );
}