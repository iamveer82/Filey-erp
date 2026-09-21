import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { FileySpinner } from "../../components/FileySpinner";
import AiFundingControl from "../../components/AiFundingControl";
import {
  buyAiCredits,
  creditHistory,
  creditMoney,
  getCreditStatus,
  saveCreditLimits,
  type CreditStatus,
} from "../../lib/aiCredits";
import { supabase } from "../../lib/supabase";

export default function AiCreditsPanel() {
  const [data, setData] = useState<CreditStatus | null>(null),
    [busy, setBusy] = useState("load"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [task, setTask] = useState("1"),
    [daily, setDaily] = useState("5");
  const [params, setParams] = useSearchParams();
  const [hasMore, setHasMore] = useState(false);
  const [accountVersion, setAccountVersion] = useState(0);
  useEffect(() => {
    const sub = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        setData(null);
        setAccountVersion((n) => n + 1);
      }
    });
    return () => sub?.data.subscription.unsubscribe();
  }, []);
  async function refresh() {
    setBusy("load");
    setError("");
    try {
      const value = await getCreditStatus(true);
      setData(value);
      setHasMore(value.history.length === 30);
      setTask(String(value.account.task_limit_micros / 1e6));
      setDaily(String(value.account.daily_limit_micros / 1e6));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    let alive = true;
    setBusy("load");
    setError("");
    void getCreditStatus()
      .then((value) => {
        if (alive) {
          setData(value);
          setHasMore(value.history.length === 30);
          setTask(String(value.account.task_limit_micros / 1e6));
          setDaily(String(value.account.daily_limit_micros / 1e6));
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy("");
      });
    return () => {
      alive = false;
    };
  }, [accountVersion]);
  useEffect(() => {
    const state = params.get("credit_checkout");
    if (!state) return;
    setNotice(
      state === "cancelled"
        ? "Checkout cancelled. No credits were added."
        : "Checkout finished. Credits appear after payment is verified. Refresh if your balance has not updated yet."
    );
    const next = new URLSearchParams(params);
    next.delete("credit_checkout");
    setParams(next, { replace: true });
    void refresh();
  }, [params, setParams]);
  async function purchase(id: string) {
    setBusy(id);
    setError("");
    try {
      await buyAiCredits(id);
      setNotice("Complete checkout in your browser, then refresh your balance here.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("limits");
    setError("");
    setNotice("");
    try {
      const account = await saveCreditLimits(Number(task), Number(daily));
      setData((current) => (current ? { ...current, account } : current));
      setNotice("Spending limits saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function more() {
    if (!data?.history.length) return;
    setBusy("history");
    setError("");
    try {
      const rows = await creditHistory(data.history[data.history.length - 1].id);
      setData((current) =>
        current ? { ...current, history: [...current.history, ...rows] } : current
      );
      setHasMore(rows.length === 30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI credits</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Optional, on every plan. Your balance stays with your account.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          disabled={!!busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          Refresh balance
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-[8px] border border-danger/30 bg-danger/5 p-3 text-[13px] text-danger"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-[8px] bg-hover p-3 text-[13px]">
          {notice}
        </p>
      )}
      {!data && busy === "load" && (
        <p role="status" className="flex items-center gap-2 p-5 text-sm">
          <FileySpinner size={18} />
          Loading your balance…
        </p>
      )}
      {data && (
        <SettingsPanel>
          <SettingsSection
            title="Your balance"
            description="AI credits are separate from your Basic, Pro or Ultra subscription."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Wallet size={16} />
                  Available to spend · USD
                </div>
                <p className="text-3xl font-semibold tabular-nums">
                  {creditMoney(Math.max(0, data.account.available_micros))}
                </p>
              </div>
              <AiFundingControl />
            </div>
            {data.account.reserved_micros > 0 && (
              <p className="text-xs text-muted-foreground">
                {creditMoney(data.account.reserved_micros, true)} reserved for requests in
                progress. Unused funds are released when they finish.
              </p>
            )}
            {data.configured &&
              data.account.available_micros >= 0 &&
              data.account.available_micros < 1000000 && (
                <p role="status" className="text-[13px] text-warning">
                  {data.account.available_micros === 0
                    ? "Add credits to start using Filey-funded models."
                    : "Your AI balance is below $1. Top up before your next large task."}
                </p>
              )}
            {data.account.blocked && (
              <p role="alert" className="text-sm text-danger">
                Spending is paused while a payment dispute is reviewed.
              </p>
            )}
            {data.account.balance_micros < 0 && (
              <p role="alert" className="text-sm text-danger">
                Refund adjustment: {creditMoney(data.account.balance_micros, true)}.
                Top-ups first cover this amount.
              </p>
            )}
            {data.notice && (
              <p className="text-sm text-muted-foreground">{data.notice}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {data.packs.map((pack) => (
                <button
                  type="button"
                  className="btn-primary"
                  key={pack.id}
                  disabled={!!busy || !data.topups_enabled}
                  onClick={() => void purchase(pack.id)}
                >
                  {busy === pack.id ? (
                    <FileySpinner size={15} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                  {creditMoney(pack.cents * 10000)} credit · Pay{" "}
                  {creditMoney((pack.cents + (data.topup_fee_cents ?? 0)) * 10000)}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each top-up includes a {creditMoney((data.topup_fee_cents ?? 0) * 10000)}{" "}
              Filey service fee, separate from your spendable credit. No auto-recharge or
              subscription required. Taxes, if applicable, appear at checkout. Paid
              credits do not expire and are excluded from the subscription refund program.
              A stopped request can still use credits for work already performed.
            </p>
            <Link
              to="/settings?section=ai"
              className="inline-flex min-h-10 items-center text-[13px] underline underline-offset-4"
            >
              Prefer your own API key? Manage your connection
            </Link>
          </SettingsSection>
          <SettingsSection
            title="Spending limits"
            description="These limits apply to paid model usage. Each task can make multiple model requests. Daily limits reset at midnight UTC."
          >
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-[13px]">
                  Per task · USD
                  <input
                    className="input mt-2"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="50"
                    step="0.01"
                    required
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                  />
                </label>
                <label className="block text-[13px]">
                  Per day · USD
                  <input
                    className="input mt-2"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="100"
                    step="0.01"
                    required
                    value={daily}
                    onChange={(e) => setDaily(e.target.value)}
                  />
                </label>
              </div>
              <button className="btn-secondary" disabled={!!busy}>
                {busy === "limits" && <FileySpinner size={15} />}Save limits
              </button>
            </form>
          </SettingsSection>
          <SettingsSection
            title="Model rates"
            description={
              data.markup_bps
                ? `Rates include ${data.markup_bps / 100}% service markup. Cached input is charged at the provider's actual cost.`
                : "Pay the provider's usage cost, with no Filey usage markup. Free models never deduct credit and have shared availability limits."
            }
            stacked
          >
            {data.models.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="th">Model</th>
                      <th className="th whitespace-nowrap">Input / 1M tokens</th>
                      <th className="th whitespace-nowrap">Output / 1M tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model) => (
                      <tr key={model.id}>
                        <td className="td">
                          <span className="font-medium">{model.name}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {model.vision ? "Text, images & tools" : "Text & tools"}
                          </span>
                        </td>
                        <td className="td whitespace-nowrap">
                          {creditMoney(
                            model.input * 1e12 * (1 + data.markup_bps / 10000),
                            true
                          )}
                        </td>
                        <td className="td whitespace-nowrap">
                          {creditMoney(
                            model.output * 1e12 * (1 + data.markup_bps / 10000),
                            true
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Model rates will appear when Filey-funded AI is available.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Credits currently cover chat, vision input and agent reasoning. Separate
              image-generation, voice and external service fees use their own provider
              connections.
            </p>
          </SettingsSection>
          <SettingsSection
            title="Activity"
            description="Your top-ups, model usage and refunds. Small usage charges are shown to six decimal places."
            stacked
          >
            {data.history.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="th">Activity</th>
                        <th className="th">Date</th>
                        <th className="th text-right">Amount · USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history.map((row) => (
                        <tr key={row.id}>
                          <td className="td">
                            <span className="block font-medium">
                              {row.kind === "usage"
                                ? "AI usage"
                                : row.kind === "refund"
                                  ? "Refund"
                                  : "Top-up"}
                            </span>
                            <span
                              className="block max-w-64 truncate text-xs text-muted-foreground"
                              title={row.description}
                            >
                              {row.description}
                            </span>
                          </td>
                          <td className="td whitespace-nowrap">
                            {new Date(row.created_at).toLocaleString()}
                          </td>
                          <td className="td whitespace-nowrap text-right tabular-nums">
                            {row.amount_micros > 0 ? "+" : ""}
                            {creditMoney(row.amount_micros, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!!busy}
                    onClick={() => void more()}
                  >
                    Load earlier activity
                  </button>
                )}
              </>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                No activity yet. Top-ups and AI usage will appear here.
              </p>
            )}
          </SettingsSection>
        </SettingsPanel>
      )}
    </div>
  );
}
