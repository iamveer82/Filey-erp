import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, LockKeyhole } from "lucide-react";
import { FileySpinner } from "./FileySpinner";
import { BILLING_UNAVAILABLE } from "../lib/billingService";

/** Review an order before leaving Filey for the provider's secure payment page. */
export default function PaymentReview({
  title,
  lines,
  total,
  terms,
  onBack,
  onPay,
  onVerify,
}: {
  title: string;
  lines: { label: string; value: string }[];
  total: string;
  terms: string;
  onBack: () => void;
  onPay: () => Promise<"browser" | "redirected">;
  onVerify: () => Promise<boolean>;
}) {
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    heading.current?.focus();
  }, []);
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (opened) {
        const verified = await onVerify();
        setPaid(verified);
        setNotice(
          verified
            ? "Payment confirmed. Your purchase is ready to use."
            : "Payment is not confirmed yet. Finish checkout in your browser, then check again."
        );
      } else if ((await onPay()) === "browser") {
        setOpened(true);
        setNotice(
          "Your secure payment page is open in your browser. Return here after paying."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : BILLING_UNAVAILABLE);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Payment" className="mx-auto w-full max-w-xl space-y-6">
      <button
        type="button"
        className="btn-ghost min-h-11"
        onClick={onBack}
        disabled={busy}
      >
        <ArrowLeft size={16} /> {paid ? "Back to Filey" : "Back"}
      </button>
      <div>
        <p className="text-xs text-muted-foreground">Secure checkout</p>
        <h2
          ref={heading}
          tabIndex={-1}
          className="mt-2 text-xl font-semibold outline-none"
        >
          {title}
        </h2>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border bg-card px-5">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-5 py-4 text-sm">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="text-right font-medium tabular-nums">{line.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-5 py-5">
          <dt className="font-medium">Total before tax</dt>
          <dd className="text-right text-xl font-semibold tabular-nums">{total}</dd>
        </div>
      </dl>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {terms} Applicable taxes and available payment methods appear on the next page.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-hover p-3 text-sm">
          {notice}
        </p>
      )}
      {!paid && (
        <button
          type="button"
          className="btn-primary min-h-11 w-full"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? <FileySpinner size={16} /> : <ArrowUpRight size={16} />}
          {busy
            ? opened
              ? "Checking payment…"
              : "Opening secure checkout…"
            : opened
              ? "I’ve paid · Check payment"
              : "Continue to payment"}
        </button>
      )}
      <p className="flex items-start justify-center gap-2 text-xs leading-relaxed text-muted-foreground">
        <LockKeyhole size={14} className="shrink-0" /> Payments are securely processed by
        Dodo Payments. Filey never stores your card details.
      </p>
    </section>
  );
}
