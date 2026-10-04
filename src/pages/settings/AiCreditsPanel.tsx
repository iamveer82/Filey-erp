import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import CoinMark from "../../components/CoinMark";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { FileySpinner } from "../../components/FileySpinner";
import PaymentReview from "../../components/PaymentReview";
import AiFundingControl from "../../components/AiFundingControl";
import {
  AI_CREDITS_EVENT,
  buyAiCredits,
  creditHistory,
  creditMoney,
  creditCoin,
  getCreditStatus,
  verifyCreditCheckout,
  type CreditStatus,
} from "../../lib/aiCredits";
import { supabase } from "../../lib/supabase";
import { getCacheScope } from "../../lib/api";
import { AGENT_STORAGE_EVENT } from "../../lib/agentStorage";

export default function AiCreditsPanel() {
  const [data, setData] = useState<CreditStatus | null>(null),
    [busy, setBusy] = useState("load"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [params, setParams] = useSearchParams();
  const [hasMore, setHasMore] = useState(false);
  const [accountVersion, setAccountVersion] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [reviewedPromotion, setReviewedPromotion] = useState<{ review: string; offer: NonNullable<CreditStatus["test_promotion"]> } | null>(null);
  const checkoutOrder = useRef<{ id: string; review: string } | null>(null);
  const walletRequest = useRef(0);
  const scope = getCacheScope();
  const walletOwner = useRef(scope?.slice(scope.lastIndexOf(":user:") + 6) ?? null);
  const [checkoutReturn, setCheckoutReturn] = useState<{ cancelled: boolean; orderId: string } | null>(null);
  useEffect(() => {
    const updateOwner = (user: string | null) => {
      if (user !== walletOwner.current) {
        walletOwner.current = user;
        walletRequest.current++;
        setData(null);
        checkoutOrder.current = null;
        setReviewedPromotion(null);
        setCheckoutReturn(null);
        setNotice("");
        setAccountVersion((n) => n + 1);
      }
    };
    const sub = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") updateOwner(null);
      if (event === "SIGNED_IN") updateOwner(session?.user.id ?? null);
    });
    const workspaceChanged = () => {
      const selected = getCacheScope();
      updateOwner(selected?.slice(selected.lastIndexOf(":user:") + 6) ?? null);
    };
    window.addEventListener(AGENT_STORAGE_EVENT, workspaceChanged);
    return () => {
      sub?.data.subscription.unsubscribe();
      window.removeEventListener(AGENT_STORAGE_EVENT, workspaceChanged);
    };
  }, []);
  const refresh = useCallback(async (force = true) => {
    const request = ++walletRequest.current;
    setBusy("load");
    setError("");
    try {
      const confirmed = checkoutReturn
        ? await verifyCreditCheckout(checkoutReturn.orderId) : null;
      if (request !== walletRequest.current) return;
      const value = await getCreditStatus(force || !!checkoutReturn);
      if (request !== walletRequest.current) return;
      setData(value);
      setHasMore(value.history.length === 30);
      if (confirmed !== null) setNotice(confirmed
        ? "Payment confirmed. Your Coin is ready to use."
        : checkoutReturn?.cancelled
          ? "Checkout closed. Your balance shows any confirmed Coin."
          : "Payment is not confirmed yet. Coin appears after payment is verified. Refresh if your balance has not updated yet.");
    } catch (e) {
      if (request === walletRequest.current) {
        setError((e as Error).message);
        if (checkoutReturn)
          setNotice("Payment is not confirmed yet. Refresh your balance to check again.");
      }
    } finally {
      if (request === walletRequest.current) setBusy("");
    }
  }, [checkoutReturn]);
  useEffect(() => {
    const requests = walletRequest;
    void refresh(false);
    return () => { requests.current++; };
  }, [accountVersion, refresh]);
  useEffect(() => {
    const state = params.get("credit_checkout");
    if (!state) return;
    setCheckoutReturn({ cancelled: state === "cancelled", orderId: params.get("credit_order") ?? "" });
    setNotice("Checking payment…");
    const next = new URLSearchParams(params);
    next.delete("credit_checkout");
    next.delete("credit_order");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const reviewing = params.has("pack") || params.has("amount_cents");
  useEffect(() => {
    if (reviewing) return; // PaymentReview owns checkout return verification.
    let alive = true, queued = false;
    const update = () => {
      if (document.visibilityState === "hidden" || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (alive) void refresh();
      });
    };
    window.addEventListener(AI_CREDITS_EVENT, update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      alive = false;
      window.removeEventListener(AI_CREDITS_EVENT, update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [reviewing, refresh]);
  async function more() {
    if (!data?.history.length) return;
    const request = ++walletRequest.current;
    setBusy("history");
    setError("");
    try {
      const rows = await creditHistory(data.history[data.history.length - 1].id);
      if (request !== walletRequest.current) return;
      setData((current) =>
        current ? { ...current, history: [...current.history, ...rows] } : current
      );
      setHasMore(rows.length === 30);
    } catch (e) {
      if (request === walletRequest.current) setError((e as Error).message);
    } finally {
      if (request === walletRequest.current) setBusy("");
    }
  }

  const customLimits = data?.custom_topup;
  const validCustomCents = (cents: number) =>
    !!customLimits &&
    Number.isSafeInteger(cents) &&
    cents >= customLimits.min_cents &&
    cents <= customLimits.max_cents;
  const quickPack = [...(data?.packs ?? [])].sort((a, b) => a.cents - b.cents)[0];
  const quickTopup = customLimits && validCustomCents(customLimits.min_cents) &&
    (!quickPack || customLimits.min_cents < quickPack.cents)
    ? { cents: customLimits.min_cents, choice: customLimits.min_cents }
    : quickPack ? { cents: quickPack.cents, choice: quickPack.id } : null;
  function reviewTopup(choice: string | number) {
    if (!data?.topups_enabled || busy) return;
    checkoutOrder.current = null;
    setReviewedPromotion(null);
    setCheckoutReturn(null);
    setNotice("");
    const next = new URLSearchParams(params);
    next.delete("pack");
    next.delete("amount_cents");
    next.set(typeof choice === "number" ? "amount_cents" : "pack", String(choice));
    setParams(next);
  }
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
    ? `Enter ${creditMoney(customLimits.min_cents * 10000)}–${creditMoney(customLimits.max_cents * 10000)} USD, with up to two decimal places. 1 Coin = $1.`
    : "";
  const promotionFor = (cents: number) => {
    const offer = data?.test_promotion;
    return offer && cents === 500 && offer.cents === cents &&
      offer.discount_cents === cents + (data?.topup_fee_cents ?? 0) &&
      offer.id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offer.id) &&
      Date.parse(offer.expires_at) > Date.now() ? offer : null;
  };
  if (selectedTopup && data?.topups_enabled) {
    const review = `${accountVersion}:${selectedTopup.choice}`;
    // Keep the reviewed free offer after checkout claims it. A subsequent wallet
    // refresh must neither replace it with a paid checkout nor reset verification.
    const promotion = reviewedPromotion?.review === review
      ? reviewedPromotion.offer : promotionFor(selectedTopup.cents);
    const discountCents = promotion?.discount_cents ?? 0;
    return (
      <PaymentReview
        key={review}
        title="Add Coin"
        artwork={<CoinMark size={64} />}
        lines={[
          {
            label: creditCoin(selectedTopup.cents * 10000),
            value: creditMoney(selectedTopup.cents * 10000),
          },
          {
            label: "Filey service fee",
            value: creditMoney((data.topup_fee_cents ?? 0) * 10000),
          },
          ...(promotion ? [{ label: "100% test discount", value: `-${creditMoney(discountCents * 10000)}` }] : []),
        ]}
        total={`${creditMoney((selectedTopup.cents + (data.topup_fee_cents ?? 0) - discountCents) * 10000)} USD`}
        terms={`${promotion ? "Your one-use test discount covers the 5 Coin top-up and service fee. " : ""}1 Coin = $1 of AI usage. One-time top-up. No subscription or auto-recharge. Coin does not expire. Top-ups are final and non-refundable, except where required by law. Coin cannot be withdrawn or exchanged for cash.`}
        onBack={() => {
          checkoutOrder.current = null;
          setReviewedPromotion(null);
          const next = new URLSearchParams(params);
          next.delete("pack");
          next.delete("amount_cents");
          setParams(next);
        }}
        onPay={async () => {
          const request = walletRequest.current;
          if (promotion) setReviewedPromotion({ review, offer: promotion });
          const checkout = promotion
            ? await buyAiCredits(selectedTopup.choice, promotion.id)
            : await buyAiCredits(selectedTopup.choice);
          if (request !== walletRequest.current)
            throw new Error("Your account changed. Reopen your Coin wallet.");
          checkoutOrder.current = { id: checkout.order_id, review };
          return checkout.mode;
        }}
        onVerify={async () => {
          const order = checkoutOrder.current;
          if (!order || order.review !== review) return false;
          const request = ++walletRequest.current;
          const confirmed = await verifyCreditCheckout(order.id);
          if (checkoutOrder.current !== order || request !== walletRequest.current) return false;
          const value = await getCreditStatus(true);
          if (checkoutOrder.current !== order || request !== walletRequest.current) return false;
          setData(value);
          setHasMore(value.history.length === 30);
          return confirmed;
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <CoinMark size={64} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Coin wallet</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Coin powers Filey AI. Optional on every plan, with your balance saved to your
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
            title="Your Coin"
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
            description="Coin is Filey's AI credit. It is separate from your Basic, Pro or Ultra subscription."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <CoinMark />
                  Available to spend
                </div>
                <p className="text-3xl font-semibold tabular-nums">
                  {creditCoin(Math.max(0, data.account.available_micros), true)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {creditMoney(Math.max(0, data.account.available_micros), true)} USD · 1
                  Coin = $1
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AiFundingControl />
                {quickTopup && (
                  <button
                    type="button"
                    className="btn-primary min-h-11"
                    disabled={!!busy || !data.topups_enabled}
                    onClick={() => reviewTopup(quickTopup.choice)}
                  >
                    <Plus size={15} /> Quick recharge · {creditCoin(quickTopup.cents * 10000)}
                  </button>
                )}
              </div>
            </div>
            {data.account.reserved_micros > 0 && (
              <p className="text-xs text-muted-foreground">
                {creditCoin(data.account.reserved_micros, true)} reserved for requests in
                progress. Unused funds are released when they finish.
              </p>
            )}
            {data.configured &&
              data.account.available_micros >= 0 &&
              data.account.available_micros < 1000000 && (
                <p role="status" className="text-[13px] text-warning">
                  {data.account.available_micros === 0
                    ? "Insufficient credit. Add Coin to continue."
                    : "Your balance is below 1 Coin ($1). Top up before your next large task."}
                </p>
              )}
            {data.account.blocked && (
              <p role="alert" className="text-sm text-danger">
                Spending is paused while a payment dispute is reviewed.
              </p>
            )}
            {data.account.balance_micros < 0 && (
              <p role="alert" className="text-sm text-danger">
                Payment adjustment: {creditCoin(data.account.balance_micros, true)}.
                Top-ups first cover this amount.
              </p>
            )}
            {!data.configured && (
              <p className="text-sm text-muted-foreground">
                Filey AI is not available yet. Your own API key still works.
              </p>
            )}
            {!data.topups_enabled && (
              <p role="status" className="text-sm text-muted-foreground">
                Coin purchases are not available yet. You can keep using your own API
                key; no payment will be taken.
              </p>
            )}
            <h3 className="text-sm font-semibold">Add Coin</h3>
            {promotionFor(500) && (
              <p role="status" className="text-[13px] text-muted-foreground">
                One-use test offer: add 5 Coin for $0.00. The service fee is included in your 100% discount.
              </p>
            )}
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
                  onClick={() => reviewTopup(pack.id)}
                >
                  {busy === pack.id ? (
                    <FileySpinner size={15} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                  {creditCoin(pack.cents * 10000)} · Pay{" "}
                  {creditMoney((pack.cents + (data.topup_fee_cents ?? 0) - (promotionFor(pack.cents)?.discount_cents ?? 0)) * 10000)}
                </button>
              ))}
            </div>
            {customLimits && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!customValid || busy || !data.topups_enabled) return;
                  reviewTopup(customCents);
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
                    You receive {creditCoin(customCents * 10000)}. The service fee is
                    added separately.
                  </p>
                )}
              </form>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each top-up includes a {creditMoney((data.topup_fee_cents ?? 0) * 10000)}{" "}
              Filey service fee, separate from your spendable Coin. No auto-recharge or
              subscription required. Taxes, if applicable, appear at checkout. Paid Coin
              does not expire. Top-ups are final and non-refundable, except where
              required by law. Coin cannot be withdrawn or exchanged for cash. A
              stopped request can still use Coin for work already performed.
            </p>
            <Link
              to="/settings?section=ai"
              className="inline-flex min-h-10 items-center text-[13px] underline underline-offset-4"
            >
              Prefer your own API key? Manage your connection
            </Link>
          </SettingsSection>
          <SettingsSection
            title="Coin usage"
            description="Filey AI usage is deducted from your available Coin balance."
            stacked
          >
            <div>
              <p className="text-sm font-medium">Filey AI</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Use Filey AI with Coin. You can also use your own API key or a local
                connection without a Filey usage fee.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              1 Coin = $1. Coin covers chat, vision input and agent reasoning. Separate
              image, video and voice generation use your own API connections and are
              billed by those providers.
            </p>
          </SettingsSection>
          <SettingsSection
            title="Activity"
            description="Your top-ups, Filey AI usage and balance adjustments. Small usage charges are shown to six decimal places in Coin."
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
                                ? "Filey AI usage"
                                : row.kind === "refund"
                                  ? "Adjustment"
                                  : "Top-up"}
                            </span>
                            <span
                              className="block max-w-64 truncate text-xs text-muted-foreground"
                            >
                              {row.kind === "usage"
                                ? "Coin used by Filey AI."
                                : row.kind === "refund"
                                  ? row.amount_micros < 0
                                    ? "Coin removed after a payment reversal."
                                    : "Unused Coin restored to your wallet."
                                  : row.description}
                            </span>
                          </td>
                          <td className="td whitespace-nowrap">
                            {new Date(row.created_at).toLocaleString()}
                          </td>
                          <td className="td whitespace-nowrap text-right tabular-nums">
                            {row.amount_micros > 0 ? "+" : ""}
                            {creditCoin(row.amount_micros, true)}
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
