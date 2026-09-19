import { useSearchParams } from "react-router-dom";
import { useUI } from "../../lib/ui";
import {
  getSubscription,
  startCheckout,
  openBillingPortal,
  awaitCloudPlan,
  planCardFor,
  PLANS,
  type PlanCard,
  type Subscription,
} from "../../lib/subscription";
import {
  startFreedomCheckout,
  claimPurchasedLicense,
  verifyStoredLicense,
  cloudAccess,
  entitlement,
  FREE_LIMITS,
} from "../../lib/license";
import { Check } from "lucide-react";
import { billing, erp, crm, quotes, invoicesThisMonth } from "../../lib/api";
import { useEffect, useState } from "react";
import { fmtDate, cn } from "../../lib/format";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { isLocalMode } from "../../lib/dataMode";

const ENTERPRISE_MAILTO =
  "mailto:sales@filey.co?subject=Filey%20ERP%20Enterprise%20enquiry";

export default function BillingPanel() {
  const { toast } = useUI();
  const [params] = useSearchParams();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [statsError, setStatsError] = useState(false);
  const [sub, setSub] = useState<Subscription>({ plan: "free" });
  const [subLoading, setSubLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [ownsUltra, setOwnsUltra] = useState(false);
  const [invoicesUsed, setInvoicesUsed] = useState<number | null>(null);
  const [capped, setCapped] = useState(true);

  useEffect(() => {
    const refreshOwned = () => {
      void verifyStoredLicense().then((l) => setOwnsUltra(l.valid));
      void getSubscription().then(setSub).catch(() => {});
      void Promise.all([entitlement(true), cloudAccess(true)]).then(([tier, access]) => {
        setCapped(tier === "free" && (isLocalMode() || !["paid", "grandfathered"].includes(access.reason)));
      });
    };
    refreshOwned();
    void invoicesThisMonth().then(setInvoicesUsed).catch(() => {});
    // A purchase collected in the background (auth.tsx) updates this page too.
    window.addEventListener("filey:entitlement", refreshOwned);
    return () => window.removeEventListener("filey:entitlement", refreshOwned);
  }, []);

  useEffect(() => {
    let failed = false;
    const guard = <T,>(p: Promise<T[]>): Promise<T[]> =>
      p.catch(() => {
        failed = true;
        return [];
      });
    Promise.all([
      guard(erp.products()),
      guard(erp.orders()),
      guard(quotes.listDocs()),
      guard(billing.listDocs()),
      guard(crm.customers()),
    ]).then(([p, o, q, i, c]) => {
      setStatsError(failed);
      setStats({
        Products: p.length,
        Orders: o.length,
        Quotations: q.length,
        Invoices: i.length,
        Customers: c.length,
      });
    });
    getSubscription()
      .then(setSub)
      .catch((e) =>
        toast.error(
          "Failed to load subscription: " + (e instanceof Error ? e.message : e)
        )
      )
      .finally(() => setSubLoading(false));
  }, []);

  // Once on mount only. With [params, toast] deps the success toast re-renders
  // the provider, both deps get fresh identities, and the effect loops —
  // endless "Subscription updated" toasts after returning from Stripe.
  useEffect(() => {
    const c = params.get("checkout");
    if (c === "success") {
      toast.success("Subscription updated - welcome aboard!");
      // Strip the param so leaving Settings and coming back doesn't re-toast.
      params.delete("checkout");
      window.history.replaceState(null, "", `?${params.toString()}`);
      // The webhook, not this redirect, is what switches the plan on — so wait
      // for it rather than showing Free to someone who just paid.
      awaitCloudPlan(12, 2500)
        .then((s) => s && setSub(s))
        .catch(() => {});
    } else if (c === "cancel") {
      toast.info("Checkout canceled.");
      params.delete("checkout");
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (p: PlanCard) => {
    if (p.id === "free") return;
    setBusy(p.id);
    try {
      if (p.kind === "contact") {
        window.location.href = ENTERPRISE_MAILTO;
        return;
      }
      if (p.kind === "license") {
        // Ultra: one-time. On desktop the checkout opens in the system
        // browser, so this window waits for the webhook instead of redirecting.
        if ((await startFreedomCheckout()) === "redirected") return;
        toast.info("Finish the payment in your browser — this page unlocks by itself.");
        const state = await claimPurchasedLicense(60, 5000);
        if (state?.valid) setOwnsUltra(true);
        toast[state ? "success" : "info"](
          state
            ? "Ultra is active on this device."
            : "No payment yet. When it completes, reopen this page and it activates."
        );
        return;
      }
      if ((await startCheckout("cloud")) === "redirected") return;
      toast.info("Finish the payment in your browser — this page unlocks by itself.");
      const updated = await awaitCloudPlan();
      if (updated) {
        setSub(updated);
        toast.success("Pro is active on this workspace.");
      } else {
        toast.info("No subscription yet. When it completes, reopen this page.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const manage = async () => {
    setBusy("manage");
    try {
      await openBillingPortal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  // The org's plan says Basic for someone who bought Ultra: the licence lives
  // on the device, not the org. Show what they actually have.
  const current =
    sub.plan === "free" && ownsUltra ? PLANS.find((p) => p.id === "lite")! : planCardFor(sub.plan);
  const owned = (p: PlanCard) => p.id === current.id || (p.id === "lite" && ownsUltra);
  const cap = FREE_LIMITS.invoicesPerMonth;
  const pctUsed = Math.min(100, Math.round(((invoicesUsed ?? 0) / cap) * 100));

  return (
    <>
      <SettingsPanel>
        <SettingsSection
          title="Current plan"
          description="Your subscription and renewal details."
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {subLoading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading plan…
                </p>
              ) : (
                <p className="text-base font-semibold text-foreground">
                  {current.name}
                  {sub.plan !== "free" && sub.plan_status ? ` · ${sub.plan_status}` : ""}
                </p>
              )}
              {sub.plan !== "free" && sub.current_period_end && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Renews {fmtDate(sub.current_period_end)}
                </p>
              )}
            </div>
            {sub.plan !== "free" && (
              <button className="btn-ghost" onClick={manage} disabled={busy === "manage"}>
                {busy === "manage" ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Usage"
          description="What this workspace holds, and your invoice allowance this month."
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium tabular-nums text-foreground">
              {capped
                ? `${invoicesUsed ?? "–"} / ${cap} invoices this month`
                : "Unlimited invoices"}
            </span>
          </div>
          {capped && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-hover"
              role="progressbar"
              aria-label="Invoices used this month"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pctUsed}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${pctUsed}%`,
                  // design.md: no gradients — flat amber accent, red at ≥90%.
                  background:
                    pctUsed >= 90 ? "hsl(var(--danger))" : "hsl(var(--primary-400))",
                }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {!capped
              ? "This workspace has unlimited invoices."
              : pctUsed >= 100
                ? "You've used this month's 5 new invoices. You can keep editing existing invoices without a limit."
                : "Basic includes 5 new invoices a month and unlimited edits. Cloud usage resets on the 1st at 00:00 UTC."}
          </p>
          {statsError ? (
            <p role="alert" className="text-sm text-danger">
              Couldn't load your usage counts — check your connection and refresh.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border pt-4 sm:grid-cols-3 xl:grid-cols-5">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {v.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </SettingsSection>

        <SettingsSection
          title="Available plans"
          description="Choose the plan that fits your workspace."
          stacked
        >
          <div className="grid gap-4 md:grid-cols-2 items-stretch">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex min-w-0 flex-col rounded-lg border p-5",
                  owned(p) ? "border-foreground/30" : "border-border"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{p.name}</p>
                  {owned(p) ? (
                    <span className="pill bg-hover text-foreground text-xs">Current</span>
                  ) : (
                    p.recommended && (
                      <span className="pill bg-hover text-muted-foreground text-xs">
                        Recommended
                      </span>
                    )
                  )}
                </div>
                <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">
                  {p.price}
                  {p.period && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {p.period}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-brand-500">{p.blurb}</p>
                <ul className="mt-4 flex-1 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check
                        size={14}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  {owned(p) ? (
                    <button className="btn-ghost w-full" disabled>
                      Your plan
                    </button>
                  ) : p.id === "free" ? (
                    <p className="py-2 text-center text-xs text-brand-400">
                      {sub.plan !== "free"
                        ? "Cancel Pro in the billing portal to return to Basic"
                        : "Everything in Basic is part of your plan"}
                    </p>
                  ) : (
                    <button
                      className={cn(
                        "w-full",
                        p.recommended ? "btn-primary" : "btn-ghost"
                      )}
                      onClick={() => buy(p)}
                      disabled={busy === p.id}
                    >
                      {busy === p.id
                        ? "Redirecting…"
                        : p.kind === "contact"
                          ? "Contact sales"
                          : p.kind === "license"
                            ? `Get ${p.name} - ${p.price}`
                            : `Get ${p.name}`}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      </SettingsPanel>
    </>
  );
}
