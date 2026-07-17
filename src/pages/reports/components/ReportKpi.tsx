/* ── ReportKpi: Apple-style KPI card for the reports module ─────────────────
 * Wraps the design-system MetricCard with a loading skeleton + tone helper. */
import type { ReactNode } from "react";
import { MetricCard, Skeleton } from "../../../components/ui";
import { cn } from "../../../lib/format";

export type KpiTone = "up" | "down" | "warn";

export function ReportKpi({
  label,
  value,
  icon,
  iconClass,
  change,
  changeTone = "up",
  loading,
  className,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  iconClass?: string;
  change?: string;
  changeTone?: KpiTone;
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return <Skeleton className={cn("h-[88px] w-full rounded-xl", className)} />;
  }
  return (
    <MetricCard
      label={label}
      value={value}
      icon={icon}
      iconClass={iconClass}
      change={change}
      changeTone={changeTone}
    />
  );
}