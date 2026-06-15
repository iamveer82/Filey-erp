/* ── QuickFilter ─────────────────────────────────────────────────────────────
 * iOS-style pill toggle group for the most common status/category filters. */
import { ReactNode } from "react";
import { cn } from "../lib/format";

export interface QuickFilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface QuickFilterProps {
  options: QuickFilterOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function QuickFilter({ options, value, onChange, className }: QuickFilterProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-3xl border border-brand-200 bg-surface p-0.5 dark:border-[#2C2C2E] dark:bg-[#1C1C1E]",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-brand-100 text-ink dark:bg-[#3A3A3C] dark:text-[#F4F5F6]"
                : "text-brand-500 hover:text-ink dark:hover:text-[#F4F5F6]"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
