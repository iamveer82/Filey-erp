import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/format";

interface ShimmerButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
}

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
      ? "bg-primary-400 text-ink hover:bg-primary-500"
      : variant === "secondary"
      ? "bg-primary-100 text-primary-700 hover:bg-primary-200"
      : "bg-white/60 text-brand-600 border border-brand-200 hover:bg-brand-50 dark:bg-white/5 dark:text-[#DDE0E4] dark:border-[#3A3D45]";

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 h-10 rounded-xl px-4 text-sm font-semibold select-none overflow-hidden transition-colors",
        base,
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {/* Shimmer overlay */}
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent dark:via-white/10" />
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
