import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsSection } from "./SettingsLayout";
import { FileySpinner } from "./FileySpinner";
import {
  refundAction,
  type RefundOverview,
  type RefundPayment,
  type SubscriptionRefund,
} from "../lib/subscription";
import { supabase } from "../lib/supabase";
import { useUI } from "../lib/ui";
import { fmtDate } from "../lib/format";

const amount = (value: number, currency: string) => {
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  return format.format(value / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
};
const labels: Record<string, string> = {
  requested: "Awaiting review",
  processing: "Submitting",
  pending: "Processing refund",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  rejected: "Declined",
  needs_review: "Needs verification",
  failed: "Provider declined",
};

export default function SubscriptionRefunds() {
  const { confirm, prompt } = useUI();
  const [data, setData] = useState<RefundOverview | null>(null);
  const [payments, setPayments] = useState<RefundPayment[] | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const active = useRef(false);
  useEffect(() => {
    const clear = () => {
      generation.current++;
      setData(null);
      setPayments(null);
      setPaymentId("");
      setReason("");
      setNotice("");
      setError("");
    };
    const sub = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") clear();
    });
    window.addEventListener("filey:agent-storage", clear);
    return () => {
      generation.current++;
      sub?.data.subscription.unsubscribe();
      window.removeEventListener("filey:agent-storage", clear);
    };
  }, []);
  async function run(key: string, work: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(key);
    setError("");
    setNotice("");
    const version = generation.current;
    try {
      await work();
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function load() {
    const version = generation.current;
    const result = await refundAction<RefundOverview>({ action: "subscription_refunds" });
    if (version === generation.current) setData(result);
  }
  async function review(row: SubscriptionRefund, decision: "approve" | "reject") {
    const version = generation.current;
    if (
      decision === "approve" &&
      !(await confirm({
        title: `Refund ${amount(row.amount, row.currency)}?`,
        message: `Return the full payment ${row.payment_id} to its original payment method. This does not cancel the subscription.`,
        confirmLabel: "Issue refund",
        danger: true,
      }))
    )
      return;
    const note = await prompt({
      title: decision === "approve" ? "Approve refund" : "Decline refund",
      label: "Note for the customer",
      placeholder: "Explain the decision (at least 5 characters)",
      confirmLabel: "Continue",
    });
    if (!note || generation.current !== version) return;
    const result = await refundAction<{ message: string }>({
      action: "review_subscription_refund",
      id: row.id,
      decision,
      note,
    });
    if (generation.current === version) setNotice(result.message);
    await load();
  }
  return (
    <SettingsSection
      title="Subscription refunds"
      description="Request a review of a subscription payment. Paper purchases are excluded. Requests do not cancel your subscription."
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost"
          disabled={!!busy}
          onClick={() => void run("load", load)}
        >
          {busy === "load" ? <FileySpinner size={15} /> : <RefreshCw size={15} />}
          {data ? "Refresh requests" : "View payments & requests"}
        </button>
        <span className="text-xs text-muted-foreground">
          Refunds are subject to review.
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {data && (
        <>
          {!data.can_manage && (
            <p className="text-sm text-muted-foreground">
              Your workspace owner or admin manages subscription refunds.
            </p>
          )}
          {data.can_manage && (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  void run("payments", async () => {
                    const version = generation.current;
                    const result = await refundAction<{ payments: RefundPayment[] }>({
                      action: "subscription_refund_payments",
                    });
                    if (generation.current === version) {
                      setPayments(result.payments);
                      setPaymentId("");
                    }
                  })
                }
              >
                {busy === "payments" ? "Loading payments…" : "Request a refund"}
              </button>
              {payments &&
                (payments.length ? (
                  <form
                    className="space-y-3 border-t border-border pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run("request", async () => {
                        const version = generation.current;
                        const result = await refundAction<{ message: string }>({
                          action: "request_subscription_refund",
                          payment_id: paymentId,
                          reason,
                        });
                        if (generation.current === version) {
                          setNotice(result.message);
                          setPayments(null);
                          setReason("");
                        }
                        await load();
                      });
                    }}
                  >
                    <label className="block text-sm">
                      Subscription payment
                      <select
                        className="input mt-1 w-full"
                        value={paymentId}
                        required
                        disabled={!!busy}
                        onChange={(e) => setPaymentId(e.target.value)}
                      >
                        <option value="">Choose a recent payment</option>
                        {payments.map((p) => (
                          <option
                            key={p.payment_id}
                            value={p.payment_id}
                            disabled={data.requests.some(
                              (r) => r.payment_id === p.payment_id
                            )}
                          >
                            {fmtDate(p.created_at)} · {amount(p.amount, p.currency)} ·{" "}
                            {p.payment_id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Reason for your request
                      <textarea
                        className="input mt-1 min-h-24 w-full resize-y"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                        minLength={10}
                        maxLength={2000}
                        disabled={!!busy}
                        placeholder="Tell us what happened so we can review your payment."
                      />
                    </label>
                    <button
                      className="btn-primary"
                      disabled={!!busy || reason.trim().length < 10 || !paymentId}
                    >
                      {busy === "request" ? "Submitting…" : "Submit request"}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      Shows the latest 20 successful payments for your linked
                      subscription. Use Manage billing to cancel future renewals.
                    </p>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No paid subscription charges found for this workspace.
                  </p>
                ))}
              {!data.requests.length && (
                <p className="text-sm text-muted-foreground">No refund requests yet.</p>
              )}
              {data.requests.map((row) => (
                <div
                  key={row.id}
                  className="space-y-1 border-t border-border py-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="font-medium">
                      {amount(row.amount, row.currency)}
                    </strong>
                    <span>{labels[row.status] ?? row.status}</span>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    {fmtDate(row.created_at)} · {row.payment_id}
                  </p>
                  <p className="break-words">{row.reason}</p>
                  {row.review_note && (
                    <p className="break-words text-muted-foreground">
                      Filey: {row.review_note}
                    </p>
                  )}
                  {row.refunded_amount > 0 && (
                    <p>Returned: {amount(row.refunded_amount, row.currency)}</p>
                  )}
                </div>
              ))}
            </>
          )}
          {data.reviewer && (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Merchant review</h3>
              <p className="text-xs text-muted-foreground">
                Oldest open requests first. Verify uncertain or failed submissions in Dodo
                Payments before taking further action.
              </p>
              {!data.queue.length && (
                <p className="text-sm text-muted-foreground">All requests reviewed.</p>
              )}
              {data.queue.map((row) => (
                <div
                  key={row.id}
                  className="space-y-2 border-t border-border py-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="font-medium">
                      {amount(row.amount, row.currency)}
                    </strong>
                    <span>{labels[row.status]}</span>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    {fmtDate(row.created_at)} · {row.payment_id} · Workspace {row.org_id}
                  </p>
                  <p className="break-words">{row.reason}</p>
                  <div className="flex flex-wrap gap-2">
                    {row.status === "requested" && (
                      <>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!!busy}
                          onClick={() => void run(row.id, () => review(row, "approve"))}
                        >
                          Review & refund
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={!!busy}
                          onClick={() => void run(row.id, () => review(row, "reject"))}
                        >
                          Decline
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!!busy}
                      onClick={() =>
                        void run(row.id, async () => {
                          const version = generation.current;
                          const result = await refundAction<{ message: string }>({
                            action: "refresh_subscription_refund",
                            id: row.id,
                          });
                          if (generation.current === version) setNotice(result.message);
                          await load();
                        })
                      }
                    >
                      Check provider status
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
