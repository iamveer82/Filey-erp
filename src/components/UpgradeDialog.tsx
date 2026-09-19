import { FileySpinner as Loader2 } from "./FileySpinner";
import { useEffect, useState } from "react";
import { Check, Cloud, HardDrive } from "lucide-react";
import { Modal } from "./ui";
import { PLANS, startCheckout, awaitCloudPlan, type PlanCard } from "../lib/subscription";
import {
  startFreedomCheckout,
  claimPurchasedLicense,
  cloudAccess,
  FREE_LIMITS,
} from "../lib/license";
import { isLocalMode } from "../lib/dataMode";
import { switchWorkspace } from "../lib/switchWorkspace";
import { useUI } from "../lib/ui";

type Reason = "invoices" | "emails" | "cloud";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  const [busy, setBusy] = useState<"cloud" | "lite" | "local" | null>(null);

  useEffect(() => {
    const onOffer = (e: Event) => {
      setReason((e as CustomEvent<{ reason?: Reason }>).detail?.reason ?? "invoices");
      setOpen(true);
    };
    window.addEventListener("filey:upgrade", onOffer);
    return () => window.removeEventListener("filey:upgrade", onOffer);
  }, []);

  // A cloud workspace without Pro can read but not save — the database
  // refuses. Say so on arrival, instead of letting the first save fail with a
  // row-level-security error.
  useEffect(() => {
    if (isLocalMode()) return;
    void cloudAccess(true).then((a) => {
      if (a.allowed) return;
      setReason("cloud");
      setOpen(true);
    });
  }, []);

  const switchToDevice = async () => {
    setBusy("local");
    try {
      await switchWorkspace("local");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

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

  const buy = async (plan: PlanCard) => {
    setBusy(plan.id as "cloud" | "lite");
    try {
      const pro = plan.id === "cloud";
      if ((await (pro ? startCheckout("cloud") : startFreedomCheckout())) === "redirected") return;
      toast.info("Finish the payment in your browser — Filey unlocks by itself.");
      const done = pro ? await awaitCloudPlan() : await claimPurchasedLicense(60, 5000);
      if (done) {
        toast.success(pro ? "Pro is active — no more monthly cap." : "Ultra is active on this device.");
        setOpen(false);
      } else {
        toast.info("No payment yet. When it completes, Settings → Billing will show your plan.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const cloud = reason === "cloud";
  const headline =
    reason === "emails"
      ? "You've sent today's Basic emails"
      : `You've used all ${FREE_LIMITS.invoicesPerMonth} Basic invoices this month`;

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keep going with Filey" size="lg">
      <p className="text-sm text-muted-foreground">
        {cloud ? (
          <>
            Saving to a cloud workspace is part of Pro. Everything already here stays
            readable — subscribe to keep working in the cloud, or carry on free on this
            device with Basic.
          </>
        ) : (
          <>
            {headline}. Your work is safe and nothing is deleted — upgrade to carry on now,
            or wait and your allowance comes back {reason === "emails" ? "" : "on "}
            {resetsOn(reason)}.
          </>
        )}
      </p>

      <div className={"mt-5 grid gap-4 " + (cloud ? "" : "md:grid-cols-2")}>
        {PLANS.filter((p) => (cloud ? p.id === "cloud" : p.id !== "free")).map((p) => (
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
            <button className="btn-primary mt-4" disabled={!!busy} onClick={() => void buy(p)}>
              {busy === p.id ? <Loader2 size={15} className="animate-spin" /> : null}
              Get {p.name}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Billed by Dodo Payments. Cancel Pro any time from Settings → Billing.
        </p>
        {cloud && !hasTauri ? (
          // A browser cannot hold a local workspace; the free way is the app.
          <a className="btn-ghost" href="https://gofiley.com/#download">
            Get the free desktop app
          </a>
        ) : cloud ? (
          <button className="btn-ghost" disabled={!!busy} onClick={() => void switchToDevice()}>
            {busy === "local" ? <Loader2 size={15} className="animate-spin" /> : null}
            Use this device instead — free
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => setOpen(false)}>
            Wait until {resetsOn(reason)}
          </button>
        )}
      </div>
    </Modal>
  );
}
