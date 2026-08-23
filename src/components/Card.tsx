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
        // Outline matches the fill, same as the .card class: separation comes
        // from the --page ground behind the card, not from a grey hairline.
        "relative rounded-xl bg-card card-edge",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
