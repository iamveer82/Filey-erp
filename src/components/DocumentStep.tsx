import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export default function Step({
  n,
  title,
  subtitle,
  action,
  children,
  collapsed = false,
}: {
  n?: number;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
}) {
  const heading = <>
    {n != null && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">{n}</span>}
    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  </>;
  if (collapsed) return <details className="group rounded-2xl border border-border bg-card">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
      {heading}<ChevronDown size={16} className="shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-border p-4 sm:p-5">{action && <div className="mb-4 flex flex-wrap justify-end gap-2">{action}</div>}{children}</div>
  </details>;
  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col items-start gap-3 border-b border-border px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
        <div className="flex w-full min-w-0 flex-1 items-center gap-3 sm:w-auto">{heading}</div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
