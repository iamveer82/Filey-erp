import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/format";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-sm font-medium text-ink mb-2">{title}</h2>
      {children}
    </section>
  );
}

export function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        <div className="text-[13px] text-foreground truncate">{value}</div>
      </div>
    </div>
  );
}

export function KpiCell({
  label,
  value,
  hint,
  valueClass,
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-card p-5", className)}>
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-[24px] font-semibold tracking-tight tabular-nums",
          valueClass ?? "text-foreground"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
