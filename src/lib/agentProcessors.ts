export type ProcessorContext = {
  taskId: string;
  userId: string;
  companyId?: string;
  input: Record<string, unknown>;
};

export type ProcessorResult = Record<string, unknown>;

import { recordJournalEvent } from "./agentJournalWriter";

export const processors: Record<string, (ctx: ProcessorContext) => Promise<ProcessorResult>> = {
  assistant_turn: async (ctx) => {
    await recordJournalEvent(ctx.userId, ctx.companyId, "agent.message.accepted", ctx.taskId, { input: ctx.input });
    return { accepted: true, handled: "queued", mirrored: ctx.input };
  },
};

export function getProcessor(taskType: string) {
  return processors[taskType];
}