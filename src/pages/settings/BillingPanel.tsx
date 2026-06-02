import { useSearchParams } from "react-router-dom";
import { useUI } from "../../lib/ui";
import { getSubscription, startCheckout, openBillingPortal, PLANS, type Subscription, type Plan } from "../../lib/subscription";
import { Check } from "lucide-react";
import { billing, erp, crm, quotes } from "../../lib/api";
import { useEffect, useState } from "react";
import { fmtDate, cn } from "../../lib/format";

export default function BillingPanel() {
  const { toast } = useUI();
  const [params] = useSearchParams();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [sub, setSub] = useState<Subscription>({ plan: "free" });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      erp.products().catch(() => []),
      erp.orders().catch(() => []),
      quotes.listDocs().catch(() => []),
      billing.listDocs().catch(() => []),
      crm.customers().catch(() => []),
    ]).then(([p, o, q, i, c]) =>
      setStats({
        Products: p.length,
        Orders: o.length,
        Quotations: q.length,
        Invoices: i.length,
        Customers: c.length,
      })
    );
    getSubscription().then(setSub).catch((e) => toast.error("Failed to load subscription: " + (e instanceof Error ? e.message : e)));
  }, []);

  useEffect(() => {
    const c = params.get("checkout");
    if (c === "success") toast.success("Subscription updated — welcome aboard!");
    else if (c === "cancel") toast.info("Checkout canceled.");
  }, [params, toast]);

  const upgrade = async (plan: Plan) => {
    setBusy(plan);
    try {
      await startCheckout(plan);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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

  const current = PLANS.find((p) => p.id === sub.plan) ?? PLANS[0];
  const used = Object.values(stats).reduce((a, b) => a + b, 0);
  const LIMITS: Record<Plan, number> = { free: 500, pro: 25000, business: Infinity };
  const limit = LIMITS[sub.plan] ?? 500;
  const pctUsed = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="space-y-4">
      <div className="card-accent flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink/70">Current plan</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {current.name}
            {sub.plan !== "free" && sub.plan_status ? ` · ${sub.plan_status}` : ""}
          </p>
          {sub.plan !== "free" && sub.current_period_end && (
            <p className="mt-1 text-sm text-ink/70">Renews {fmtDate(sub.current_period_end)}</p>
          )}
        </div>
        {sub.plan !== "free" && (
          <button className="btn-ghost" onClick={manage} disabled={busy === "manage"}>
            {busy === "manage" ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-ink">Storage usage</p>
          <span className="text-sm text-brand-500">
            {used.toLocaleString()}
            {limit !== Infinity ? ` / ${limit.toLocaleString()}` : ""} records
          </span>
        </div>
        {limit !== Infinity && (
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${pctUsed}%`,
                background: pctUsed >= 90 ? "#E5484D" : "linear-gradient(90deg,#F5B700,#FFD600)",
              }}
            />
          </div>
        )}
        <p className="mt-2 text-[11px] text-brand-400">
          {limit === Infinity
            ? "Unlimited on your plan."
            : pctUsed >= 90
            ? "You're nearly out of space — upgrade your plan for more."
            : "Counts customers, products, invoices, orders and quotes."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={cn("card flex flex-col", p.id === sub.plan && "ring-2 ring-primary-400")}
          >
            <p className="font-bold text-ink">{p.name}</p>
            <p className="mt-1 text-xl font-bold text-ink">{p.price}</p>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm text-brand-500">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              {p.id === sub.plan ? (
                <span className="pill bg-primary-100 text-primary-700">Current plan</span>
              ) : p.id === "free" ? (
                <span className="text-xs text-brand-400">Downgrade in the billing portal</span>
              ) : (
                <button
                  className="btn-primary w-full"
                  onClick={() => upgrade(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? "Redirecting…" : `Upgrade to ${p.name}`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <p className="mb-3 font-bold text-ink">Usage</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-brand-200 p-3 text-center">
              <p className="text-2xl font-bold text-ink">{v}</p>
              <p className="mt-0.5 text-[11px] text-brand-400">{k}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
