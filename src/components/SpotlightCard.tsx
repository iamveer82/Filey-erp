import { ReactNode } from "react";
import { cn } from "../lib/format";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Kept for API compatibility — ignored in the minimal theme. */
  size?: number;
}

/** Minimal card surface. The former mouse-follow spotlight and spring
 *  entrance were removed for the minimal theme; same API, quiet visuals. */
export function SpotlightCard({ children, className }: SpotlightCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-brand-200/80 bg-white shadow-bento dark:border-[#3A3D45] dark:bg-[#24262C]",
        className
      )}
    >
      {children}
    </div>
  );
}
