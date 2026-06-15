/* ── EmptyState ─────────────────────────────────────────────────────────────
 * A consistent, actionable empty state for lists, cards, and panels.
 * Always include a primary CTA so the user knows what to do next. */
import { ReactNode } from "react";
import { cn } from "../lib/format";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: { label: string; onClick: () => void; icon?: ReactNode };
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-brand-200 bg-surface px-6 py-10 text-center dark:border-[#2C2C2E] dark:bg-[#1C1C1E]",
        className
      )}
    >
      {icon && (
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-white/8">
          {icon}
        </div>
      )}
      <p className="text-base font-medium text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-[36ch] text-sm text-brand-500">{description}</p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2">
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-400 px-4 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-primary-500"
            >
              {primaryAction.icon}
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-brand-500 transition-colors hover:bg-brand-50 dark:text-[#B6BAC1] dark:hover:bg-white/10"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
