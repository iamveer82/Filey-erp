import { enqueueAgentTask, AgentTask } from "./agentCore";

export type ChannelSource = "app" | "whatsapp";

export type ChannelMessage = {
  source: ChannelSource;
  externalId: string;
  userId?: string;
  companyId?: string;
  text: string;
  dedupeKey: string;
};

export type AgentEventInput = {
  source: ChannelSource;
  externalId: string;
  userId: string;
  companyId?: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  taskType?: string;
};

export function normalizeChannelMessage(message: ChannelMessage, userId: string): AgentEventInput {
  return {
    source: message.source,
    externalId: message.externalId,
    userId,
    companyId: message.companyId,
    payload: { text: message.text },
    dedupeKey: message.dedupeKey,
    taskType: "assistant_turn",
  };
}

export async function ingestChannelMessage(message: ChannelMessage, userId: string) {
  const normalized = normalizeChannelMessage(message, userId);
  return enqueueAgentTask({
    userId,
    companyId: normalized.companyId,
    taskType: normalized.taskType ?? "assistant_turn",
    input: normalized.payload,
    idempotencyKey: normalized.dedupeKey,
  } satisfies AgentTask);
}