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
        "relative rounded-2xl bg-white border border-brand-200 shadow-bento",
        "dark:bg-[#24262C] dark:border-[#3A3D45]",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
