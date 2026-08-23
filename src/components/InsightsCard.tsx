import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lightbulb, ChevronRight, CheckCircle2, Sparkles } from "lucide-react";

import { billing, fin, erp } from "../lib/api";
import { buildInsights, type Insight } from "../lib/insights";
import { narrateInsights } from "../lib/insightsNarrative";
import { aiReady } from "../lib/ai";
import { getDisplayCurrency, todayYmd, errMsg } from "../lib/format";
import { InfoCard, Skeleton } from "./ui";

/* Dashboard insights: cash gap, overdue risk, expense spikes, stockout ETAs.
 * Computed locally from the books (lib/insights.ts) — no AI key, no network
 * beyond the normal list APIs, so it works offline too. */

const DOT: Record<Insight["severity"], string> = {
  critical: "bg-danger",
  warn: "bg-warning",
  info: "bg-primary-400",
};

export default function InsightsCard() {
  const nav = useNavigate();
  const [insights, setInsights] = useState<Insight[] | null>(null);
  /** Sources that failed. Insights are advice about money — with everything
   *  failing you get zero insights, and the card used to answer that with
   *  "All clear … look healthy", which is a confident lie about your finances. */
  const [incomplete, setIncomplete] = useState<string[]>([]);
  /** Written on demand, never on mount — narrating costs a call against the
   *  user's own API key, and the card is useful without it. */
  const [summary, setSummary] = useState("");
  const [writing, setWriting] = useState(false);
  const [summaryErr, setSummaryErr] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      const missed: string[] = [];
      const src = <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> =>
        p.catch(() => {
          missed.push(label);
          return fallback;
        });
      const [sales, purchases, expenses, products, movements] = await Promise.all([
        src("sales", billing.listDocs("sales"), []),
        src("purchases", billing.listDocs("purchase"), []),
        src("expenses", fin.expenses(), []),
        src("products", erp.products(), []),
        src("stock movements", erp.stockMovements(), {}),
      ]);
      if (!dead) setIncomplete(missed);
      const list = buildInsights({
        sales,
        purchases,
        expenses,
        products,
        movements,
        today: todayYmd(),
        currency: getDisplayCurrency(),
      });
      if (!dead) setInsights(list);
    })();
    return () => {
      dead = true;
    };
  }, []);

  const summarise = async () => {
    setWriting(true);
    setSummaryErr("");
    try {
      setSummary(
        await narrateInsights(insights ?? [], { currency: getDisplayCurrency() })
      );
    } catch (e) {
      setSummaryErr(errMsg(e) || "Could not write the summary");
    } finally {
      setWriting(false);
    }
  };

  return (
    <InfoCard
      title="Insights"
      action={
        insights?.length && !incomplete.length && aiReady() ? (
          <button
            onClick={summarise}
            disabled={writing}
            className="btn-ghost h-7 px-2 text-[12.5px]"
          >
            <Sparkles size={13} /> {writing ? "Writing…" : "Summarise"}
          </button>
        ) : (
          <Lightbulb size={15} className="text-brand-400" />
        )
      }
    >
      {insights === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : incomplete.length ? (
        <p className="text-sm text-danger">
          Could not read {incomplete.join(", ")}, so these insights are incomplete - treat
          "nothing to flag" as unknown rather than fine.
        </p>
      ) : insights.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-brand-500">
          <CheckCircle2 size={15} className="text-success" />
          All clear - cash, receivables, spend and stock look healthy.
        </p>
      ) : (
        <>
          {summaryErr && <p className="mb-2 text-xs text-danger">{summaryErr}</p>}
          {summary && (
            <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm leading-relaxed text-ink dark:bg-white/5">
              {summary}
            </p>
          )}
          <ul className="divide-y divide-brand-100 dark:divide-white/8">
            {insights.slice(0, 5).map((i, idx) => (
              <li key={idx}>
                <button
                  onClick={() => i.to && nav(i.to)}
                  className="flex w-full items-start gap-2.5 py-2.5 text-left transition hover:bg-brand-50 dark:hover:bg-white/5 rounded-lg px-1.5 -mx-1.5 cursor-pointer"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.severity]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{i.title}</span>
                    <span className="block text-xs text-brand-500 mt-0.5">
                      {i.detail}
                    </span>
                  </span>
                  {i.to && (
                    <ChevronRight size={14} className="mt-1 shrink-0 text-brand-300" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </InfoCard>
  );
}
