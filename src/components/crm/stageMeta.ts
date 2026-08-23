// Shared stage presentation for the deals workspace (list, board, drawer).
// One source of truth so a stage reads identically everywhere.

export const DEAL_STAGES = [
  {
    id: "qualification",
    label: "Qualification",
    pill: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    id: "proposal",
    label: "Proposal",
    pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    id: "negotiation",
    label: "Negotiation",
    pill: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "won",
    label: "Won",
    pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  { id: "lost", label: "Lost", pill: "bg-muted text-muted-foreground" },
] as const;

export type DealStageId = (typeof DEAL_STAGES)[number]["id"];

export const STAGE_PROB: Record<string, number> = {
  qualification: 20,
  proposal: 45,
  negotiation: 70,
  won: 100,
  lost: 0,
};

export function stageMeta(stage: string) {
  return DEAL_STAGES.find((s) => s.id === stage) ?? DEAL_STAGES[0];
}

export function stageIndex(stage: string) {
  const i = DEAL_STAGES.findIndex((s) => s.id === stage);
  return i === -1 ? DEAL_STAGES.length : i;
}
