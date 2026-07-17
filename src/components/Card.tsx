import type { ReactNode } from "react";
import { cn } from "../lib/format";

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl bg-card border border-border",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
