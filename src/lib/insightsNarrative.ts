// Turns the deterministic insights from lib/insights.ts into a short spoken
// summary. Kept out of insights.ts on purpose: that file is pure and offline,
// and this one talks to whatever model the user connected in Settings.

import { aiChat, aiReady, type AiMessage } from "./ai";
import type { Insight } from "./insights";

/** The model is a narrator, not an analyst. Every number it is allowed to say
 *  is already in the facts below — computed from the books — so a summary can
 *  be wrong about emphasis but never about the money. */
const SYSTEM = [
  "You summarise a small business's finances for its owner.",
  "You will be given findings already computed from their books.",
  "Write 2-3 plain sentences: lead with whatever costs them money soonest, then the rest.",
  "Use only the figures given. Never invent a number, a customer, a date or a trend.",
  "No greeting, no sign-off, no bullet points, no markdown.",
  "If a finding is a problem, say what to do about it in the same breath.",
].join(" ");

/** One paragraph over the given insights, or "" when there is nothing to say
 *  (no findings) or nobody to say it (no AI key connected — the card falls back
 *  to the plain list, which is the offline default anyway). */
export async function narrateInsights(
  insights: Insight[],
  opts: { currency?: string; signal?: AbortSignal } = {}
): Promise<string> {
  if (!insights.length || !aiReady()) return "";
  const facts = insights
    .map((i) => `- (${i.severity}) ${i.title}. ${i.detail}`)
    .join("\n");
  const messages: AiMessage[] = [
    { role: "system", text: SYSTEM },
    {
      role: "user",
      text: `Currency: ${opts.currency || "AED"}\nFindings:\n${facts}`,
    },
  ];
  return (await aiChat(messages, { maxTokens: 300, signal: opts.signal })).trim();
}
