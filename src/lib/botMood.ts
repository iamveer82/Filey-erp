// What the assistant is doing, expressed as a face. Keeping the mapping here —
// rather than inline at each orb — means the agent chat, the copilot popover and
// anything added later show the same state for the same situation.
import type { StateId } from "./bloub/states";

export type AgentMood =
  /** nothing in flight */
  | "idle"
  /** a model request is open, nothing to show yet */
  | "thinking"
  /** tools are running: work with visible steps */
  | "working"
  /** the turn just landed */
  | "answered"
  /** the turn failed */
  | "error"
  /** long idle, or the surface is closed */
  | "asleep";

/** The body animation for a mood. */
export function botStateFor(mood: AgentMood): StateId {
  switch (mood) {
    case "thinking":
      return "thinking";
    case "working":
      return "orbit";
    case "answered":
      return "wink";
    case "error":
      return "alert";
    case "asleep":
      return "sleep";
    default:
      return "idle";
  }
}

/** The resting face for a mood. Only states that carry the base face use it —
 *  `thinking` hides the eyes entirely, `alert` prescribes its own — so this is
 *  a preference, not a guarantee. */
export function botExpressionFor(mood: AgentMood): string {
  switch (mood) {
    case "answered":
      return "heureux";
    case "error":
      return "triste";
    case "working":
      return "attentif";
    case "asleep":
      return "somnolent";
    default:
      return "neutre";
  }
}

/** How long the one-shot moods hold before falling back to idle, in ms.
 *  `answered` is a wink, which reads as a beat, not a state you sit in. */
export const MOOD_HOLD_MS: Partial<Record<AgentMood, number>> = {
  answered: 1600,
  error: 2600,
};
