import { type ReactNode, useId } from "react";
import { cn } from "../lib/format";

/** Shared, divided form surface for every Settings tab. */
export function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 divide-y divide-border rounded-xl border border-border bg-card",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  actions,
  stacked = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  stacked?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "grid min-w-0 gap-5 p-5 sm:p-6",
        !stacked && "lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8"
      )}
    >
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {description && (
          <div className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        {children}
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}
