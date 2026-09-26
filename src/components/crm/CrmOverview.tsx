import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, CheckSquare } from "lucide-react";
import {
  crmDeals,
  linkedName,
  text,
  label,
  type CrmData,
  type CrmObject,
  type CrmRow,
} from "../../lib/crmWorkspace";
import type { Activity as ActivityRow, CrmTask } from "../../lib/api";
import { aed, cn, fmtDate, todayYmd } from "../../lib/format";
import { dealHealth } from "../../lib/pipeline";
import { MetricCard } from "../ui";

export default function CrmOverview({
  data,
  onOpen,
  go,
  error,
}: {
  data: CrmData;
  onOpen: (kind: CrmObject, row: CrmRow) => void;
  go: (view: CrmObject) => void;
  error: boolean;
}) {
  const deals = crmDeals(data),
    today = todayYmd();
  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const won = deals.filter((d) => d.stage === "won"),
    lost = deals.filter((d) => d.stage === "lost");
  const next = data.tasks
    .filter((t) => !["done", "cancelled"].includes(text(t.status)))
    .sort((a, b) =>
      (text(a.due_date) || "9999").localeCompare(text(b.due_date) || "9999")
    );
  const risks = dealHealth(
    deals,
    data.activities as unknown as ActivityRow[],
    data.tasks as unknown as CrmTask[],
    today
  );
  if (error && !deals.length && !data.companies.length)
    return (
      <p className="text-sm text-muted-foreground">
        Your overview will appear when CRM data is available.
      </p>
    );
  return (
    <div className="space-y-5">
      {error && (
        <p role="status" className="text-xs text-muted-foreground">
          Showing the last successful load. Refresh before relying on these totals.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis">
        <MetricCard
          label="Open pipeline"
          value={aed(openDeals.reduce((sum, d) => sum + Number(d.value || 0), 0))}
          change={`${openDeals.length} open deals`}
        />
        <MetricCard
          label="Weighted pipeline"
          value={aed(
            openDeals.reduce(
              (sum, d) =>
                sum +
                (Number(d.value || 0) *
                  Math.max(0, Math.min(100, Number(d.probability || 0)))) /
                  100,
              0
            )
          )}
          change="Value × probability"
        />
        <MetricCard
          label="Win rate"
          value={
            won.length + lost.length
              ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%`
              : "—"
          }
          change={`${won.length} won · ${lost.length} lost · all time`}
        />
        <MetricCard
          label="Open tasks"
          value={String(next.length)}
          change={`${next.filter((t) => t.due_date && text(t.due_date) < today).length} overdue`}
        />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Next steps</h2>
            <button className="btn-ghost" onClick={() => go("tasks")}>
              All tasks <ArrowUpRight size={14} />
            </button>
          </div>
          {next.length ? (
            next.slice(0, 6).map((task) => (
              <button
                key={task.id}
                className="w-full flex gap-3 items-center py-3 border-t border-border text-left hover:bg-hover"
                onClick={() => onOpen("tasks", task)}
              >
                <CheckSquare size={16} className="text-muted-foreground shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium truncate block">
                    {text(task.title)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {linkedName(task, data)}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs whitespace-nowrap",
                    task.due_date && text(task.due_date) < today
                      ? "text-danger"
                      : "text-muted-foreground"
                  )}
                >
                  {task.due_date ? fmtDate(text(task.due_date)) : "No due date"}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground py-6">
              No open tasks. Add a next step from any company, contact, lead or deal.
            </p>
          )}
        </section>
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <button className="btn-ghost" onClick={() => go("activities")}>
              All activity <ArrowUpRight size={14} />
            </button>
          </div>
          {data.activities.length ? (
            [...data.activities]
              .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)))
              .slice(0, 6)
              .map((item) => (
                <button
                  key={item.id}
                  className="w-full py-3 border-t border-border text-left hover:bg-hover flex items-center gap-3"
                  onClick={() => onOpen("activities", item)}
                >
                  <Activity size={15} className="text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm truncate block">{text(item.subject)}</span>
                    <span className="text-xs text-muted-foreground">
                      {label(item.kind)} · {linkedName(item, data)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(item.created_at)}
                  </span>
                </button>
              ))
          ) : (
            <p className="text-sm text-muted-foreground py-6">
              Log a call, meeting, or message to build your relationship history.
            </p>
          )}
        </section>
      </div>
      <section className="card">
        <h2 className="text-sm font-semibold mb-3">Deals that need attention</h2>
        {risks.length ? (
          <div className="divide-y divide-border">
            {risks.slice(0, 5).map((risk) => (
              <button
                key={risk.opportunity.id}
                className="flex items-start gap-4 text-left w-full py-3 hover:bg-hover"
                onClick={() => {
                  const row = data.deals.find((d) => d.id === risk.opportunity.id);
                  if (row) onOpen("deals", row);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{risk.opportunity.title}</span>
                  <span className="block mt-1 text-xs text-muted-foreground">
                    {risk.risks.map((r) => r.reason).join(" · ")}
                  </span>
                </span>
                <span className="text-sm tabular-nums whitespace-nowrap">
                  {aed(risk.opportunity.value)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {deals.length
              ? "No open deals are flagged by the current rules."
              : "Create deals to track pipeline health."}
          </p>
        )}
      </section>
      <div className="text-xs text-muted-foreground">
        <Link className="underline" to="/reports?tab=insights&section=deals">
          CRM reports
        </Link>{" "}
        · Connected to Filey:{" "}
        <Link className="underline" to="/quoting">
          Quotations
        </Link>{" "}
        ·{" "}
        <Link className="underline" to="/invoicing">
          Invoices
        </Link>{" "}
        ·{" "}
        <Link className="underline" to="/follow-ups">
          Follow-ups
        </Link>{" "}
        ·{" "}
        <Link className="underline" to="/agent">
          Filey AI
        </Link>
      </div>
    </div>
  );
}
