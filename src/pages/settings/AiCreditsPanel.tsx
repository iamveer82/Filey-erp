import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import PaperMark from "../../components/PaperMark";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { FileySpinner } from "../../components/FileySpinner";
import PaymentReview from "../../components/PaymentReview";
import AiFundingControl from "../../components/AiFundingControl";
import {
  buyAiCredits,
  creditHistory,
  creditMoney,
  creditPaper,
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
  const [customAmount, setCustomAmount] = useState("");
  const [modelSearch, setModelSearch] = useState("");
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
        ? "Checkout cancelled. No Paper was added."
        : "Checkout finished. Paper appears after payment is verified. Refresh if your balance has not updated yet."
    );
    const next = new URLSearchParams(params);
    next.delete("credit_checkout");
    setParams(next, { replace: true });
    void refresh();
  }, [params, setParams]);
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

  const customLimits = data?.custom_topup;
  const modelCount = data?.models.filter((model) => model.id !== "filey-ai").length ?? 0;
  const modelQuery = modelSearch.trim().toLowerCase();
  const rateModels =
    data?.models.filter(
      (model) =>
        model.id !== "filey-ai" &&
        `${model.name} ${model.id}`.toLowerCase().includes(modelQuery)
    ) ?? [];
  const validCustomCents = (cents: number) =>
    !!customLimits &&
    Number.isSafeInteger(cents) &&
    cents >= customLimits.min_cents &&
    cents <= customLimits.max_cents;
  const amountParts = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(customAmount.trim());
  const customCents = amountParts
    ? Number(amountParts[1]) * 100 + Number((amountParts[2] ?? "").padEnd(2, "0"))
    : NaN;
  const customValid = validCustomCents(customCents);
  const amountParam = params.get("amount_cents") ?? "";
  const requestedCents = /^\d+$/.test(amountParam) ? Number(amountParam) : NaN;
  const selectedPack = data?.packs.find((pack) => pack.id === params.get("pack"));
  const selectedTopup = params.has("amount_cents")
    ? !params.has("pack") && validCustomCents(requestedCents)
      ? { cents: requestedCents, choice: requestedCents }
      : null
    : selectedPack
      ? { cents: selectedPack.cents, choice: selectedPack.id }
      : null;
  const customHelp = customLimits
    ? `Enter ${creditMoney(customLimits.min_cents * 10000)}–${creditMoney(customLimits.max_cents * 10000)} USD, with up to two decimal places. 1 Paper = $1.`
    : "";
  if (selectedTopup && data?.topups_enabled) {
    return (
      <PaymentReview
        key={String(selectedTopup.choice)}
        title="Add Paper"
        artwork={<PaperMark size={64} />}
        lines={[
          {
            label: creditPaper(selectedTopup.cents * 10000),
            value: creditMoney(selectedTopup.cents * 10000),
          },
          {
            label: "Filey service fee",
            value: creditMoney((data.topup_fee_cents ?? 0) * 10000),
          },
        ]}
        total={`${creditMoney((selectedTopup.cents + (data.topup_fee_cents ?? 0)) * 10000)} USD`}
        terms="1 Paper = $1 of AI usage. One-time top-up. No subscription or auto-recharge. Paper does not expire and is excluded from the subscription refund program."
        onBack={() => {
          const next = new URLSearchParams(params);
          next.delete("pack");
          next.delete("amount_cents");
          setParams(next);
        }}
        onPay={() => buyAiCredits(selectedTopup.choice)}
        onVerify={async () => {
          const value = await getCreditStatus(true);
          const added = value.history.some(
            (entry) =>
              entry.kind === "topup" && !data.history.some((old) => old.id === entry.id)
          );
          if (added) {
            setData(value);
            return true;
          }
          return false;
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <PaperMark size={64} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Paper wallet</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Paper powers Filey AI. Optional on every plan, with your balance saved to your
              account.
            </p>
          </div>
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
      {!data && !busy && (
        <SettingsPanel>
          <SettingsSection
            title="Your Paper"
            description="Your balance, top-ups and spending history will appear here when your Filey account is connected."
          >
            <p className="text-sm text-muted-foreground">
              Available on Basic, Pro and Ultra. You can also use your own model keys
              without adding money to Filey.
            </p>
            {/^Sign in|^Connect your Filey/.test(error) && (
              <Link className="btn-primary" to="/settings?section=datamode">
                Connect Filey account
              </Link>
            )}
            <Link className="btn-ghost" to="/settings?section=ai">
              Manage AI connections
            </Link>
          </SettingsSection>
        </SettingsPanel>
      )}
      {data && (
        <SettingsPanel>
          <SettingsSection
            title="Your balance"
            description="Paper is Filey's AI credit. It is separate from your Basic, Pro or Ultra subscription."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <PaperMark />
                  Available to spend
                </div>
                <p className="text-3xl font-semibold tabular-nums">
                  {creditPaper(Math.max(0, data.account.available_micros), true)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {creditMoney(Math.max(0, data.account.available_micros), true)} USD · 1
                  Paper = $1
                </p>
              </div>
              <AiFundingControl />
            </div>
            {data.account.reserved_micros > 0 && (
              <p className="text-xs text-muted-foreground">
                {creditPaper(data.account.reserved_micros, true)} reserved for requests in
                progress. Unused funds are released when they finish.
              </p>
            )}
            {data.configured &&
              data.account.available_micros >= 0 &&
              data.account.available_micros < 1000000 && (
                <p role="status" className="text-[13px] text-warning">
                  {data.account.available_micros === 0
                    ? "Add Paper to start using paid Filey AI models."
                    : "Your balance is below 1 Paper ($1). Top up before your next large task."}
                </p>
              )}
            {data.account.blocked && (
              <p role="alert" className="text-sm text-danger">
                Spending is paused while a payment dispute is reviewed.
              </p>
            )}
            {data.account.balance_micros < 0 && (
              <p role="alert" className="text-sm text-danger">
                Refund adjustment: {creditPaper(data.account.balance_micros, true)}.
                Top-ups first cover this amount.
              </p>
            )}
            {data.notice && (
              <p className="text-sm text-muted-foreground">{data.notice}</p>
            )}
            {!data.topups_enabled && (
              <p role="status" className="text-sm text-muted-foreground">
                Paper purchases are not available yet. You can keep using your own API
                key; no payment will be taken.
              </p>
            )}
            <h3 className="text-sm font-semibold">Add Paper</h3>
            <p className="text-[13px] text-muted-foreground">
              Choose an amount, review the total, then continue to secure payment.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.packs.map((pack) => (
                <button
                  type="button"
                  className="btn-primary"
                  key={pack.id}
                  disabled={!!busy || !data.topups_enabled}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete("amount_cents");
                    next.set("pack", pack.id);
                    setParams(next);
                  }}
                >
                  {busy === pack.id ? (
                    <FileySpinner size={15} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                  {creditPaper(pack.cents * 10000)} · Pay{" "}
                  {creditMoney((pack.cents + (data.topup_fee_cents ?? 0)) * 10000)}
                </button>
              ))}
            </div>
            {customLimits && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!customValid || busy || !data.topups_enabled) return;
                  const next = new URLSearchParams(params);
                  next.delete("pack");
                  next.set("amount_cents", String(customCents));
                  setParams(next);
                }}
              >
                <label
                  htmlFor="ai-credit-custom-amount"
                  className="block text-[13px] font-medium"
                >
                  Custom amount · USD
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id="ai-credit-custom-amount"
                    className="input min-h-11 w-full sm:max-w-56"
                    type="text"
                    inputMode="decimal"
                    maxLength={12}
                    placeholder="e.g. 12.50"
                    autoComplete="off"
                    required
                    value={customAmount}
                    disabled={!!busy || !data.topups_enabled}
                    aria-describedby="ai-credit-custom-help"
                    aria-invalid={!!customAmount && !customValid}
                    onChange={(event) => setCustomAmount(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn-secondary min-h-11"
                    disabled={!customValid || !!busy || !data.topups_enabled}
                  >
                    Review top-up <ArrowUpRight size={15} />
                  </button>
                </div>
                <p
                  id="ai-credit-custom-help"
                  className={`text-xs ${customAmount && !customValid ? "text-danger" : "text-muted-foreground"}`}
                >
                  {customHelp}
                </p>
                {customValid && (
                  <p className="text-xs text-muted-foreground">
                    You receive {creditPaper(customCents * 10000)}. The service fee is
                    added separately.
                  </p>
                )}
              </form>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each top-up includes a {creditMoney((data.topup_fee_cents ?? 0) * 10000)}{" "}
              Filey service fee, separate from your spendable Paper. No auto-recharge or
              subscription required. Taxes, if applicable, appear at checkout. Paid Paper
              does not expire and is excluded from the subscription refund program. A
              stopped request can still use Paper for work already performed.
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
            description="These limits apply to paid chat and videos. Each video is a separate task. Daily limits reset at midnight UTC."
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
            title="AI rates"
            description="Chat uses the provider's usage cost, with no Filey usage markup. Free chat models never deduct Paper and have shared availability limits."
            stacked
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <p className="text-sm font-medium">Brand videos · Seedance 2.0</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  0.25 Paper ($0.25) per second · 720p · 4–15 seconds · Charged on
                  completion
                </p>
              </div>
              <Link className="btn-ghost" to="/agent?video=1">
                {data.video_configured ? "Create a video" : "Video setup & history"}
                <ArrowUpRight size={14} />
              </Link>
            </div>
            <div>
              <p className="text-sm font-medium">Choose your model</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Choose a paid or free model in Filey AI. Paid model usage is deducted from
                your Paper balance. Spending limits apply before requests run.
              </p>
            </div>
            {!!modelCount && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  type="search"
                  aria-label="Search model rates"
                  placeholder="Search paid and free models"
                  className="input min-h-11 w-full sm:max-w-sm"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {rateModels.length} of {modelCount} models · 1 Paper = $1
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Rates vary by provider, context and time. You pay actual usage; these rates
              are spending estimates.
            </p>
            {rateModels.length ? (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left" aria-label="AI model rates">
                  <thead>
                    <tr>
                      <th className="th">Model</th>
                      <th className="th whitespace-nowrap">Input / 1M tokens</th>
                      <th className="th whitespace-nowrap">Output / 1M tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateModels.map((model) => (
                      <tr key={model.id}>
                        <td className="td">
                          <span className="font-medium">{model.name}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {model.vision ? "Text & images" : "Text"}
                          </span>
                          {!model.free && !!model.image && model.image > 0 && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Up to {creditPaper(Math.ceil(model.image * 1e6), true)} /
                              input image
                            </span>
                          )}
                        </td>
                        <td className="td whitespace-nowrap">
                          {model.free
                            ? "Free"
                            : `Up to ${creditPaper(model.input * 1e12, true)}`}
                        </td>
                        <td className="td whitespace-nowrap">
                          {model.free
                            ? "Free"
                            : `Up to ${creditPaper(model.output * 1e12, true)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {modelQuery
                  ? "No matching models. Try a provider or model name."
                  : "Model rates will appear when they are available."}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              1 Paper = $1. Paper covers chat, vision input and agent reasoning. Separate
              image-generation, voice and external service fees use their own provider
              connections.
            </p>
          </SettingsSection>
          <SettingsSection
            title="Activity"
            description="Your top-ups, model usage and refunds. Small usage charges are shown to six decimal places in Paper."
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
                        <th className="th text-right">Amount</th>
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
                            {creditPaper(row.amount_micros, true)}
                            <span className="block text-xs text-muted-foreground">
                              {creditMoney(row.amount_micros, true)} USD
                            </span>
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
