import { useBotSkin } from "./BloubBot";
import { cn } from "../lib/format";

/* The exact three-dot wave the bot wears while thinking (states.ts dotPulse):
 * the dots GROW along the chain (≈1 : 1.5 : 2), each runs the upstream
 * 1.5 s cycle — ease up, cut — and neighbours start half a cycle apart.
 * They are painted in the assistant's colour, the same ink the bot itself
 * is drawn in, so the marker reads as the bot's, not the page's. */
const TRAIL = [
  { size: "h-1 w-1", delay: "0s" },
  { size: "h-1.5 w-1.5", delay: "0.5s" },
  { size: "h-2 w-2", delay: "1s" },
];

/** The assistant-at-work marker, standing in for words while the first tokens
 *  are still in flight — visually the same dots the bot itself is wearing. */
export default function ThinkingDots({ className }: { className?: string }) {
  const skin = useBotSkin();
  return (
    <span
      className={cn("inline-flex items-center gap-[3px] py-1", className)}
      role="status"
      aria-label="Thinking"
    >
      {TRAIL.map((d, i) => (
        <span
          key={i}
          className={cn("thinking-dot rounded-full", d.size)}
          style={{ backgroundColor: skin.color, animationDelay: d.delay }}
        />
      ))}
    </span>
  );
}
