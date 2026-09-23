import { Link, useSearchParams } from "react-router-dom";
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
  licensePurchased,
  cloudAccess,
  entitlement,
  FREE_LIMITS,
} from "../../lib/license";
import { Check } from "lucide-react";
import { billing, erp, crm, quotes, invoicesThisMonth } from "../../lib/api";
import { useEffect, useRef, useState } from "react";
import { fmtDate, cn } from "../../lib/format";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { isLocalMode } from "../../lib/dataMode";
import PaymentReview from "../../components/PaymentReview";
import SubscriptionRefunds from "../../components/SubscriptionRefunds";
import { Modal, Field } from "../../components/ui";
import { invokeFn } from "../../lib/supabase";

/** Contact-sales lead → lead-contact edge function (website or app source). */
async function submitLead(input: {
  name: string;
  phone: string;
  email?: string;
  message?: string;
}): Promise<void> {
  const { supabase } = await import("../../lib/supabase");
  if (!supabase) throw new Error("Connect your Filey account to contact sales.");
  const { data, error } = await invokeFn(supabase, "lead-contact", {
    body: {
      name: input.name,
      phone: input.phone,
      email: input.email || "",
      message: input.message || "",
      source: "app",
      purpose: "enterprise",
    },
  });
  if (error) throw new Error("We couldn't send your request. Please try again shortly.");
  const body = data as { error?: string } | null;
  if (body?.error) throw new Error(body.error);
}

export default function BillingPanel() {
  const { toast } = useUI();
  const [params, setParams] = useSearchParams();
  const checkoutHandled = useRef(false);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [statsError, setStatsError] = useState(false);
  const [sub, setSub] = useState<Subscription>({ plan: "free" });
  const [subLoading, setSubLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [ownsUltra, setOwnsUltra] = useState(false);
  const [ownershipLoading, setOwnershipLoading] = useState(true);
  const [invoicesUsed, setInvoicesUsed] = useState<number | null>(null);
  const [capped, setCapped] = useState(true);
  const [contactOpen, setContactOpen] = useState<PlanCard | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactBusy, setContactBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshOwned = () => {
      setOwnershipLoading(true);
      setSubLoading(true);
      void Promise.all([verifyStoredLicense(), licensePurchased().catch(() => null)])
        .then(([local, purchased]) => {
          if (active) setOwnsUltra(purchased ?? local.valid);
        })
        .finally(() => {
          if (active) setOwnershipLoading(false);
        });
      void getSubscription()
        .then((value) => {
          if (active) setSub(value);
        })
        .catch(() => {
          if (active)
            toast.error(
              "We couldn’t load your plan. Check your connection and reopen Billing."
            );
        })
        .finally(() => {
          if (active) setSubLoading(false);
        });
      void Promise.all([entitlement(true), cloudAccess(true)]).then(([tier, access]) => {
        if (active)
          setCapped(tier === "free" && (isLocalMode() || access.reason !== "paid"));
      });
    };
    refreshOwned();
    void invoicesThisMonth()
      .then(setInvoicesUsed)
      .catch(() => {});
    // A purchase collected in the background (auth.tsx) updates this page too.
    window.addEventListener("filey:entitlement", refreshOwned);
    return () => {
      active = false;
      window.removeEventListener("filey:entitlement", refreshOwned);
    };
  }, [toast]);

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
  }, []);

  // A return URL is not proof of payment. Only the verified webhook activates
  // the plan. Let the router remove this parameter without losing its hash.
  useEffect(() => {
    const c = params.get("checkout");
    if (checkoutHandled.current || !["success", "cancel"].includes(c ?? "")) return;
    checkoutHandled.current = true;
    const next = new URLSearchParams(params);
    next.delete("checkout");
    setParams(next, { replace: true });
    if (c === "success") {
      toast.info("Confirming your payment…");
      if (
        params.get("section") === "license" ||
        ["ultra", "freedom"].includes(params.get("plan") ?? "")
      ) {
        claimPurchasedLicense(12, 2500)
          .then((state) => {
            if (state?.valid) {
              setOwnsUltra(true);
              toast.success("Ultra is active on this device.");
            } else
              toast.info("Payment is still processing. Reopen Billing to check again.");
          })
          .catch(() =>
            toast.error(
              "We couldn’t confirm your plan yet. Reopen Billing to check again."
            )
          );
        return;
      }
      awaitCloudPlan(12, 2500)
        .then((s) => {
          if (s) {
            setSub(s);
            window.dispatchEvent(new Event("filey:entitlement"));
            toast.success("Pro is active on this workspace.");
          } else
            toast.info("Payment is still processing. Reopen Billing to check again.");
        })
        .catch(() =>
          toast.error("Could not verify your payment. Reopen Billing to check again.")
        );
    } else if (c === "cancel") {
      toast.info("Checkout canceled.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manage = async () => {
    if (busy) return;
    setBusy("manage");
    try {
      await openBillingPortal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // The org's plan says Basic for someone who bought Ultra: the licence lives
  // on the device, not the org. Show what they actually have.
  const current =
    sub.plan === "free" && ownsUltra
      ? PLANS.find((p) => p.id === "lite")!
      : planCardFor(sub.plan);
  const owned = (p: PlanCard) => p.id === current.id || (p.id === "lite" && ownsUltra);
  const cap = FREE_LIMITS.invoicesPerMonth;
  const pctUsed = Math.min(100, Math.round(((invoicesUsed ?? 0) / cap) * 100));

  const purchase = PLANS.find(
    (p) => p.id === params.get("purchase") && (p.id === "cloud" || p.id === "lite")
  );
  if (purchase && !subLoading && !ownershipLoading && !owned(purchase)) {
    return (
      <PaymentReview
        key={purchase.id}
        title={`Get Filey ${purchase.name}`}
        lines={[
          { label: `Filey ${purchase.name}`, value: purchase.price },
          {
            label: "Billing",
            value: purchase.id === "cloud" ? "Monthly subscription" : "One-time purchase",
          },
        ]}
        total={`${purchase.price} USD`}
        terms={
          purchase.id === "cloud"
            ? "Renews every month. Cancel any time in Billing."
            : "Pay once for Ultra. Your account unlocks automatically after payment is confirmed."
        }
        onBack={() => {
          const next = new URLSearchParams(params);
          next.delete("purchase");
          setParams(next);
        }}
        onPay={() =>
          purchase.id === "cloud" ? startCheckout("cloud") : startFreedomCheckout()
        }
        onVerify={async () => {
          if (purchase.id === "lite") {
            const state = await claimPurchasedLicense(1, 0);
            if (state?.valid) setOwnsUltra(true);
            return !!state?.valid;
          }
          const state = await awaitCloudPlan(1, 0);
          if (state) {
            setSub(state);
            window.dispatchEvent(new Event("filey:entitlement"));
          }
          return !!state;
        }}
      />
    );
  }

  return (
    <>
      <SettingsPanel>
        <SettingsSection
          title="Current plan"
          description="Purchased benefits activate automatically. No license key or manual setup needed."
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {subLoading || ownershipLoading ? (
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
              <button className="btn-ghost" onClick={manage} disabled={busy !== null}>
                {busy === "manage" ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="AI wallet"
          description="Optional credits for every plan, separate from your subscription."
        >
          <Link className="btn-ghost" to="/settings?section=credits">
            Open AI wallet
          </Link>
        </SettingsSection>

        <SettingsSection
          title="Devices"
          description="Paid access is applied automatically when you sign in on an eligible device."
        >
          <Link className="btn-ghost" to="/settings?section=devices">
            Manage devices
          </Link>
        </SettingsSection>

        <SubscriptionRefunds />

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
                  ) : p.kind === "contact" ? (
                    <button
                      className="btn-ghost w-full"
                      onClick={() => setContactOpen(p)}
                      disabled={busy !== null}
                    >
                      Contact sales
                    </button>
                  ) : (
                    <button
                      className={cn(
                        "w-full",
                        p.recommended ? "btn-primary" : "btn-ghost"
                      )}
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.set("purchase", p.id);
                        setParams(next);
                      }}
                      disabled={busy !== null || ownershipLoading || subLoading}
                    >
                      {busy === p.id
                        ? "Redirecting…"
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

      <Modal
        open={!!contactOpen}
        onClose={() => setContactOpen(null)}
        title={`Talk to sales — Filey ${contactOpen?.name ?? ""}`}
        size="md"
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!contactOpen) return;
            if (!contactName.trim() || contactPhone.replace(/\D/g, "").length < 6) {
              toast.error("Please give a name and a valid phone number.");
              return;
            }
            setContactBusy(true);
            try {
              await submitLead({
                name: contactName.trim(),
                phone: contactPhone.trim(),
                email: contactEmail.trim(),
                message:
                  contactMessage.trim() ||
                  `Interested in Filey ${contactOpen.name} (${contactOpen.price}).`,
              });
              toast.success("Request sent — we'll be in touch shortly.");
              setContactOpen(null);
              setContactName("");
              setContactPhone("");
              setContactEmail("");
              setContactMessage("");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            } finally {
              setContactBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            Leave your details and we'll reach out about Filey {contactOpen?.name}.
          </p>
          <Field label="Name">
            <input
              className="input"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              required
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label="Email (optional)">
            <input
              className="input"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field label="Message (optional)">
            <textarea
              className="textarea"
              rows={3}
              value={contactMessage}
              onChange={(e) => setContactMessage(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setContactOpen(null)}
              disabled={contactBusy}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={contactBusy}>
              {contactBusy ? "Sending…" : "Send request"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
