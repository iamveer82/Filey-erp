export type ProcessorContext = {
  taskId: string;
  userId: string;
  companyId?: string;
  input: Record<string, unknown>;
};

export type ProcessorResult = Record<string, unknown>;

export const processors: Record<string, (ctx: ProcessorContext) => Promise<ProcessorResult>> = {
  assistant_turn: async (ctx) => {
    return { accepted: true, handled: "queued", mirrored: ctx.input };
  },
};

export function getProcessor(taskType: string) {
  return processors[taskType];
}