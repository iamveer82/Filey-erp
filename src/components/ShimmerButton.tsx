import { ReactNode } from "react";
import { cn } from "../lib/format";

interface ShimmerButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
}

/** Minimal button. The former shimmer sweep and scale-on-hover were removed
 *  for the minimal theme; renders as a standard button variant. */
export function ShimmerButton({
  children,
  className,
  onClick,
  disabled,
  type = "button",
  variant = "primary",
}: ShimmerButtonProps) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
      ? "btn-secondary"
      : "btn-ghost";

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(base, className)}
    >
      {children}
    </button>
  );
}
