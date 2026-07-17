import { ReactNode } from "react";
import { cn } from "../lib/format";

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  /** Kept for API compatibility — ignored in the minimal theme. */
  gradient?: string;
}

/** Minimal card surface. The former 3D-tilt/glow treatment was removed for
 * the minimal theme; this is now a plain quiet card with the same API. */
export function MagicCard({ children, className }: MagicCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-brand-200/80 bg-white",
        className
      )}
    >
      {children}
    </div>
  );
}
