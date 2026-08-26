import { useEffect, useState } from "react";
import { Cloud, KeyRound, Laptop, ShieldCheck, ShoppingCart, Unplug, Copy, Check } from "lucide-react";
import { cloudConfigured, supabase } from "../../lib/supabase";
import {
  verifyStoredLicense,
  LITE_DEVICE_LIMIT,
  activateThisDevice,
  redeemVoucher,
  deactivateDevice,
  startLiteCheckout,
  licenseOverview,
  listOrgDevices,
  releaseOrgDevice,
  deviceId,
  entitlement,
  ENFORCE_LICENSING,
  CLOUD_DEVICE_LIMIT,
  FREE_LIMITS,
  type LicenseState,
  type OrgDevice,
  type Tier,
} from "../../lib/license";
import { fmtDate } from "../../lib/format";

/** Desktop (Lite) license — buy once, activate up to 2 devices, verified
 *  offline forever. Cloud (Pro) subscription lives in Billing. */
export default function LicensePanel() {
  const [local, setLocal] = useState<LicenseState | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof licenseOverview>>>(null);
  const [orgDevices, setOrgDevices] = useState<OrgDevice[]>([]);
  const [thisDevice, setThisDevice] = useState("");
  const [tier, setTier] = useState<Tier>("free");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [voucher, setVoucher] = useState("");
  /** Website leads with their minted coupon codes — the owner reads the code
   *  here (and in email) and sends it once payment lands. */
  const [leads, setLeads] = useState<
    { id: string; name: string; phone: string; email: string | null; code: string; status: string; created_at: string }[]
  >([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLeads = async () => {
    if (!cloudConfigured || !supabase) return;
    try {
      const { data } = await supabase
        .from("lead_coupons")
        .select("id, name, phone, email, code, status, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      setLeads((data ?? []) as never);
    } catch {
      /* offline — the list is owner-only convenience */
    }
  };

  const refresh = () => {
    verifyStoredLicense().then(setLocal).catch(() => {});
    deviceId().then(setThisDevice).catch(() => {});
    entitlement(true).then(setTier).catch(() => {});
    loadLeads();
    if (cloudConfigured) {
      licenseOverview().then(setOverview).catch(() => {});
      listOrgDevices().then(setOrgDevices).catch(() => {});
    }
  };
  useEffect(refresh, []);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reasonText: Record<string, string> = {
    not_activated: "This device isn't activated yet.",
    wrong_device: "The stored license belongs to a different device.",
    bad_signature: "The stored license failed verification.",
    malformed: "The stored license is damaged - activate again.",
    wrong_product: "The stored license is for a different product.",
  };

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink flex items-center gap-2">
          <KeyRound size={18} /> Desktop License
        </h2>
        <p className="text-sm text-brand-500 mt-1">
          One-time purchase. Verified offline on this device - no internet
          needed after activation. Up to 2 devices per license. Cloud sync is
          a separate subscription under Billing.
        </p>
        <p className="text-sm mt-2">
          <span className="text-brand-500">Current plan: </span>
          <span className="font-medium text-ink capitalize">{tier}</span>
          {tier === "free" && (
            <span className="text-brand-400">
              {" "}
              - {FREE_LIMITS.invoicesPerMonth} invoices/month, "Made with Filey"
              on documents
            </span>
          )}
        </p>
      </div>

      {!ENFORCE_LICENSING && (
        <p className="text-xs rounded-lg bg-brand-50 dark:bg-white/5 px-3 py-2 text-brand-500">
          Licensing is not enforced yet - all features work without a license
          while Filey is pre-launch.
        </p>
      )}

      {/* This device */}
      <div className="rounded-xl border border-border p-4">
        <p className="font-medium text-ink flex items-center gap-2">
          <Laptop size={15} /> This device
        </p>
        {local?.valid ? (
          <p className="text-sm text-success mt-1 flex items-center gap-1.5">
            <ShieldCheck size={14} /> Activated - licensed to{" "}
            {local.payload?.email || "this account"} (issued {local.payload?.issued}).
            Works fully offline.
          </p>
        ) : (
          <p className="text-sm text-brand-500 mt-1">
            {reasonText[local?.reason ?? ""] ?? "Checking…"}
          </p>
        )}
        {thisDevice && (
          <p className="text-[11px] text-brand-400 mt-1 font-mono">ID {thisDevice}</p>
        )}
        {cloudConfigured && (
          <div className="flex gap-2 mt-3">
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => run(activateThisDevice, "Device activated.")}
            >
              <ShieldCheck size={15} /> Activate this device
            </button>
            {local?.valid && (
              <button
                className="btn-ghost text-danger"
                disabled={busy}
                onClick={() =>
                  run(
                    () => deactivateDevice(thisDevice),
                    "Device deactivated - slot freed."
                  )
                }
              >
                <Unplug size={15} /> Deactivate
              </button>
            )}
          </div>
        )}
        {!cloudConfigured && (
          <p className="text-xs text-brand-400 mt-2">
            Activation needs the cloud build once - this offline build can only
            verify an already-activated license.
          </p>
        )}
      </div>

      {/* Account license + slots */}
      {cloudConfigured && (
        <div className="rounded-xl border border-border p-4">
          <p className="font-medium text-ink">Your license</p>
          {overview ? (
            <>
              <p className="text-sm text-brand-500 mt-1">
                Purchased {fmtDate(overview.license.created_at)} · {overview.license.status} ·{" "}
                {overview.devices.filter((d) => !d.deactivated_at).length}/{LITE_DEVICE_LIMIT} device slots used
              </p>
              <ul className="mt-2 space-y-1.5">
                {overview.devices.map((d) => (
                  <li
                    key={d.fingerprint}
                    className="text-sm flex items-center justify-between gap-2"
                  >
                    <span className="text-ink min-w-0 truncate">
                      {d.device_name || "Device"}{" "}
                      {d.fingerprint === thisDevice && (
                        <span className="text-xs text-primary-600">(this device)</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs ${d.deactivated_at ? "text-brand-400" : "text-success"}`}
                      >
                        {d.deactivated_at ? "deactivated" : "active"} · {fmtDate(d.activated_at)}
                      </span>
                      {!d.deactivated_at && (
                        <button
                          className="text-xs text-danger hover:underline cursor-pointer disabled:opacity-50 transition-opacity"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Deactivate "${d.device_name || "this device"}"? The device will lose its offline license and needs re-activation.`
                              )
                            )
                              return;
                            run(
                              () => deactivateDevice(d.fingerprint),
                              "Device deactivated - slot freed. Activate your new device now."
                            );
                          }}
                        >
                          <Unplug size={14} className="inline" /> Deactivate
                        </button>
                      )}
                    </span>
                  </li>
                ))}
                {!overview.devices.length && (
                  <li className="text-sm text-brand-400">No devices activated yet.</li>
                )}
              </ul>
              <p className="text-xs text-brand-400 mt-2">
                Using a third machine? Deactivate one of the devices above, then
                press "Activate this device" on the new machine.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-brand-500 mt-1">
                No license on this account yet.
              </p>
              <button
                className="btn-primary mt-3"
                disabled={busy}
                onClick={() => run(startLiteCheckout, "Redirecting to checkout…")}
              >
                <ShoppingCart size={15} /> Buy desktop license
              </button>

              <div className="mt-4 border-t border-border pt-4">
                <label htmlFor="voucher" className="text-sm font-medium text-ink flex items-center gap-1.5">
                  <KeyRound size={14} /> Have a voucher?
                </label>
                <p className="text-xs text-brand-400 mt-1">
                  Redeem a promo code to unlock offline mode for free.
                </p>
                <form
                  className="flex gap-2 mt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (voucher.trim())
                      run(() => redeemVoucher(voucher), "Voucher redeemed - offline mode unlocked on this device.");
                  }}
                >
                  <input
                    id="voucher"
                    className="input flex-1"
                    placeholder="Enter voucher code"
                    autoCapitalize="characters"
                    value={voucher}
                    onChange={(e) => setVoucher(e.target.value)}
                  />
                  <button className="btn-ghost" disabled={busy || !voucher.trim()}>
                    Redeem
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* Cloud (Pro) devices - 5 per organization, shared with the team */}
      {cloudConfigured && (
        <div className="rounded-xl border border-border p-4">
          <p className="font-medium text-ink flex items-center gap-2">
            <Cloud size={15} /> Cloud devices
          </p>
          <p className="text-sm text-brand-500 mt-1">
            Devices signed in to your cloud workspace - yours, employees',
            teammates'. Up to {CLOUD_DEVICE_LIMIT} at a time; release one to
            make room for a new device.{" "}
            {orgDevices.length}/{CLOUD_DEVICE_LIMIT} in use.
          </p>
          <ul className="mt-2 space-y-1.5">
            {orgDevices.map((d) => (
              <li key={d.id} className="text-sm flex items-center justify-between gap-2">
                <span className="text-ink min-w-0 truncate">
                  {d.device_name || "Device"}{" "}
                  {d.fingerprint === thisDevice && (
                    <span className="text-xs text-primary-600">(this device)</span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-brand-400">
                    last seen {fmtDate(d.last_seen)}
                  </span>
                  <button
                    className="text-xs text-danger hover:underline cursor-pointer disabled:opacity-50 transition-opacity"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => releaseOrgDevice(d.id),
                        "Device released - the slot is free."
                      )
                    }
                  >
                    <Unplug size={14} className="inline" /> Release
                  </button>
                </span>
              </li>
            ))}
            {!orgDevices.length && (
              <li className="text-sm text-brand-400">No cloud devices registered yet.</li>
            )}
          </ul>
          <p className="text-xs text-brand-400 mt-2">
            You can release your own devices; org admins can release anyone's.
          </p>
        </div>
      )}

      {/* Website leads + their coupon codes — send the code after payment. */}
      {leads.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <p className="font-medium text-ink flex items-center gap-2">
            <KeyRound size={15} /> Freedom leads &amp; coupons
          </p>
          <p className="text-sm text-brand-500 mt-1">
            Visitors who asked for the plan. Each code unlocks the offline
            license ONCE and expires unused after 30 days. Copy → send after
            payment.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {leads.map((l) => (
              <li key={l.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {l.name} · {l.phone}
                    {l.email ? ` · ${l.email}` : ""}
                  </p>
                  <p className="text-xs text-brand-400">
                    {fmtDate(l.created_at)} ·{" "}
                    {l.status === "redeemed"
                      ? "redeemed ✓"
                      : l.status === "sent"
                        ? "code sent"
                        : "code not sent yet"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <code className="text-[12px] font-semibold tracking-wide text-ink">
                    {l.code}
                  </code>
                  <button
                    aria-label="Copy code"
                    title="Copy code"
                    className="grid h-7 w-7 place-items-center rounded-md text-brand-400 hover:text-ink hover:bg-hover cursor-pointer"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(l.code);
                        setCopiedId(l.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      } catch {
                        /* clipboard denied — the code is visible on screen */
                      }
                    }}
                  >
                    {copiedId === l.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  {l.status === "new" && (
                    <button
                      className="text-xs text-brand-500 hover:text-ink hover:underline cursor-pointer"
                      disabled={busy}
                      onClick={async () => {
                        await supabase!
                          .from("lead_coupons")
                          .update({ status: "sent" })
                          .eq("id", l.id);
                        loadLeads();
                      }}
                    >
                      Mark sent
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && (<p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2">{msg}</p>)}
      {err && (
        <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{err}</p>
      )}
    </div>
  );
}
