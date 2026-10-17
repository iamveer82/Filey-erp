import PaymentReview from "./PaymentReview";
import { useEffect, useState } from "react";
import { Check, Cloud, HardDrive } from "lucide-react";
import { Modal } from "./ui";
import { PLANS, startCheckout, awaitCloudPlan, type PlanCard } from "../lib/subscription";
import { startFreedomCheckout, claimPurchasedLicense, FREE_LIMITS } from "../lib/license";
import { useUI } from "../lib/ui";

/** Why it opened: a Basic cap, the trial ending, or someone choosing to get Freedom. */
type Reason = "invoices" | "emails" | "trial" | "freedom";

/** When the Basic allowance comes back: the 1st of next month for invoices,
 *  tomorrow for the daily email cap. */
const resetsOn = (reason: Reason) => {
  if (reason === "emails") return "tomorrow";
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
};

/** The upgrade prompt, mounted once and opened by a `filey:upgrade` event.
 *
 *  Hitting the Basic limit used to be a red toast and a dead end, with the way
 *  out three screens away in Settings. This offers both plans where the wall
 *  appeared, and closes without argument — the invoice being written is not
 *  lost, it just cannot be saved until they choose or the month rolls over.
 */
export default function UpgradeDialog() {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("invoices");
  const [selected, setSelected] = useState<PlanCard | null>(null);

  useEffect(() => {
    const onOffer = (e: Event) => {
      setReason((e as CustomEvent<{ reason?: Reason }>).detail?.reason ?? "invoices");
      setSelected(null);
      setOpen(true);
    };
    window.addEventListener("filey:upgrade", onOffer);
    return () => window.removeEventListener("filey:upgrade", onOffer);
  }, []);

  // A purchase can land from outside this dialog (the website, a browser tab
  // left open). auth.tsx announces it; say so and get out of the way.
  useEffect(() => {
    const onPaid = () => {
      setOpen(false);
      toast.success("Your plan is active — thank you for buying Filey.");
    };
    window.addEventListener("filey:entitlement", onPaid);
    return () => window.removeEventListener("filey:entitlement", onPaid);
    // toast is recreated every render; subscribing once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headline =
    reason === "emails"
      ? "You've sent today's Basic emails"
      : `You've used all ${FREE_LIMITS.invoicesPerMonth} Basic cloud invoices this month`;
  const trialing = reason === "trial" || reason === "freedom";

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={reason === "trial" ? "Your free trial has ended" : "Keep going with Filey"}
      size="lg"
    >
      {selected ? (
        <PaymentReview
          key={selected.id}
          title={`Get Filey ${selected.name}`}
          lines={[
            { label: `Filey ${selected.name}`, value: selected.price },
            {
              label: "Billing",
              value:
                selected.id === "cloud" ? "Monthly subscription" : "One-time purchase",
            },
          ]}
          total={selected.price}
          terms={
            selected.id === "cloud"
              ? "Renews every month. Cancel any time in Billing."
              : "Pay once for Freedom. Your account unlocks after payment is confirmed."
          }
          onBack={() => setSelected(null)}
          onPay={() =>
            selected.id === "cloud" ? startCheckout("cloud") : startFreedomCheckout()
          }
          onVerify={async () =>
            selected.id === "cloud"
              ? !!(await awaitCloudPlan(1, 0))
              : !!(await claimPurchasedLicense(1, 0))?.valid
          }
        />
      ) : (
        <>
          {trialing ? (
            <p className="text-sm text-muted-foreground">
              {reason === "trial"
                ? "Thanks for trying Filey. Get Freedom to keep creating and editing: pay once and use Filey for life, with every app, updates and support. Everything you made is still here to view, print and export."
                : "Pay once and use Filey for life, or keep your workspace in the cloud with Pro."}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {headline}. Upgrade to create more now, or your allowance comes back{" "}
              {reason === "emails" ? "" : "on "}
              {resetsOn(reason)}.{" "}
              {reason === "invoices" &&
                "You can keep editing existing invoices without a limit."}
            </p>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {/* Freedom first: it is what most people want after trying Filey. */}
            {PLANS.filter((p) => p.id === "lite" || p.id === "cloud").sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended)).map((p) => (
              <div
                key={p.id}
                className={
                  "flex flex-col rounded-lg border p-4 " +
                  (p.recommended ? "border-foreground/30" : "border-border")
                }
              >
                <div className="flex items-center gap-2">
                  {p.id === "cloud" ? (
                    <Cloud size={16} className="text-muted-foreground" />
                  ) : (
                    <HardDrive size={16} className="text-muted-foreground" />
                  )}
                  <p className="text-sm font-semibold text-foreground">{p.name}</p>
                </div>
                <p className="mt-2 font-pixel text-2xl text-foreground">
                  {p.price}
                  <span className="text-xs text-muted-foreground">{p.period}</span>
                </p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-muted-foreground">
                  {p.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex gap-1.5">
                      <Check size={13} className="mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button className="btn-primary mt-4" onClick={() => setSelected(p)}>
                  Get {p.name}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Billed by Dodo Payments. Freedom is a one-time payment; cancel Pro any time from Settings → Billing.
            </p>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              {reason === "trial" ? "View my data" : "Back to my workspace"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
