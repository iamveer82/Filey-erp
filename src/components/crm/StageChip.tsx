import { cn } from "../../lib/format";
import { stageMeta } from "./stageMeta";

/** Small stage pill — the same treatment as the board's column headers. */
export default function StageChip({
  stage,
  className,
}: {
  stage: string;
  className?: string;
}) {
  const meta = stageMeta(stage);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium",
        meta.pill,
        className
      )}
    >
      {meta.label}
    </span>
  );
}
