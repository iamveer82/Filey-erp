import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShoppingCart, Unplug, Copy, Check } from "lucide-react";
import { cloudConfigured, supabase } from "../../lib/supabase";
import {
  verifyStoredLicense,
  LITE_DEVICE_LIMIT,
  activateThisDevice,
  redeemVoucher,
  deactivateDevice,
  startFreedomCheckout,
  claimPurchasedLicense,
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
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

/** Desktop (Lite) license — buy once, activate up to 2 devices, verified
 *  offline forever. Cloud (Pro) subscription lives in Billing. */
export default function LicensePanel() {
  const [local, setLocal] = useState<LicenseState | null>(null);
  const [overview, setOverview] =
    useState<Awaited<ReturnType<typeof licenseOverview>>>(null);
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
    {
      id: string;
      name: string;
      phone: string;
      email: string | null;
      code: string;
      status: string;
      created_at: string;
    }[]
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
    verifyStoredLicense()
      .then(setLocal)
      .catch(() => {});
    deviceId()
      .then(setThisDevice)
      .catch(() => {});
    entitlement(true)
      .then(setTier)
      .catch(() => {});
    loadLeads();
    if (cloudConfigured) {
      licenseOverview()
        .then(setOverview)
        .catch(() => {});
      listOrgDevices()
        .then(setOrgDevices)
        .catch(() => {});
    }
  };
  useEffect(refresh, []);

  // Coming back from Dodo's checkout. The webhook is what actually grants the
  // licence, so wait for it and activate this device — the buyer paid, they
  // should not also have to find a button.
  useEffect(() => {
    const outcome = new URLSearchParams(location.hash.split("?")[1] ?? "").get("checkout");
    if (!cloudConfigured || outcome !== "success") return;
    let cancelled = false;
    setBusy(true);
    setMsg("Payment received — activating this device…");
    claimPurchasedLicense()
      .then((state) => {
        if (cancelled) return;
        if (state) {
          setMsg("Freedom is active on this device.");
          refresh();
        } else {
          setErr(
            "We haven't seen the payment yet. It can take a moment — reopen this page, " +
              "or contact support if it doesn't appear."
          );
        }
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Buy, then unlock. In the browser the page redirects to Dodo and the
   *  effect above finishes the job on return; on desktop the checkout opens in
   *  the system browser, so this window stays put and waits for the webhook. */
  const buyFreedom = async () => {
    if ((await startFreedomCheckout()) === "redirected") return;
    setMsg("Finish the payment in your browser — this page unlocks by itself.");
    const state = await claimPurchasedLicense(60, 5000);
    if (!state)
      throw new Error(
        "No payment has arrived yet. When it completes, reopen this page and the licence activates."
      );
  };

  const reasonText: Record<string, string> = {
    not_activated: "This device isn't activated yet.",
    wrong_device: "The stored license belongs to a different device.",
    bad_signature: "The stored license failed verification.",
    malformed: "The stored license is damaged - activate again.",
    wrong_product: "The stored license is for a different product.",
  };

  return (
    <SettingsPanel>
      <SettingsSection
        title="Desktop license"
        description="Paid desktop benefits, verified offline after activation."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          One-time purchase. Verified offline on this device - no internet needed after
          activation. Up to 2 devices per license. Cloud sync is a separate subscription
          under Billing.
        </p>
        <p className="text-sm mt-2">
          <span className="text-brand-500">Current plan: </span>
          <span className="font-medium text-ink capitalize">{tier}</span>
          {tier === "free" && (
            <span className="text-brand-400">
              {" "}
              - unlimited local invoices; hosted cloud: {FREE_LIMITS.invoicesPerMonth}
              /month, "Made with Filey" on documents
            </span>
          )}
        </p>
        {!ENFORCE_LICENSING && (
          <p className="text-xs rounded-lg bg-hover px-3 py-2 text-muted-foreground">
            Licensing is not enforced yet - all features work without a license while
            Filey is pre-launch.
          </p>
        )}
      </SettingsSection>

      {/* This device */}
      <SettingsSection
        title="This device"
        description="Review activation and manage this computer's license."
      >
        {local?.valid ? (
          <p className="text-sm text-success flex items-start gap-1.5">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              Activated - licensed to {local.payload?.email || "this account"} (issued{" "}
              {local.payload?.issued}). Works fully offline.
            </span>
          </p>
        ) : (
          <p className="text-sm text-brand-500 mt-1">
            {reasonText[local?.reason ?? ""] ?? "Checking…"}
          </p>
        )}
        {thisDevice && (
          <p className="text-xs text-muted-foreground font-mono break-all">
            ID {thisDevice}
          </p>
        )}
        {cloudConfigured && (
          <div className="flex flex-wrap gap-2">
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
            Activation needs the cloud build once - this offline build can only verify an
            already-activated license.
          </p>
        )}
      </SettingsSection>

      {/* Account license + slots */}
      {cloudConfigured && (
        <SettingsSection
          title="Your license"
          description={`Activate up to ${LITE_DEVICE_LIMIT} devices with your desktop license.`}
        >
          {overview ? (
            <>
              <p className="text-sm text-brand-500 mt-1">
                Purchased {fmtDate(overview.license.created_at)} ·{" "}
                {overview.license.status} ·{" "}
                {overview.devices.filter((d) => !d.deactivated_at).length}/
                {LITE_DEVICE_LIMIT} device slots used
              </p>
              <ul className="divide-y divide-border">
                {overview.devices.map((d) => (
                  <li
                    key={d.fingerprint}
                    className="py-3 text-sm flex flex-wrap items-center justify-between gap-3"
                  >
                    <span className="text-foreground min-w-0 break-words">
                      {d.device_name || "Device"}{" "}
                      {d.fingerprint === thisDevice && (
                        <span className="text-xs text-primary-600">(this device)</span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-xs ${d.deactivated_at ? "text-brand-400" : "text-success"}`}
                      >
                        {d.deactivated_at ? "deactivated" : "active"} ·{" "}
                        {fmtDate(d.activated_at)}
                      </span>
                      {!d.deactivated_at && (
                        <button
                          className="btn-ghost text-danger"
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
                Using a third machine? Deactivate one of the devices above, then press
                "Activate this device" on the new machine.
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
                onClick={() => run(buyFreedom, "Freedom is active on this device.")}
              >
                <ShoppingCart size={15} /> Buy desktop license
              </button>

              <div className="mt-4 border-t border-border pt-4">
                <label
                  htmlFor="voucher"
                  className="text-sm font-medium text-ink flex items-center gap-1.5"
                >
                  <KeyRound size={14} /> Have a voucher?
                </label>
                <p className="text-xs text-brand-400 mt-1">
                  Redeem a promo code to activate paid desktop benefits. Core local tools
                  are already free.
                </p>
                <form
                  className="flex flex-wrap gap-2 mt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (voucher.trim())
                      run(
                        () => redeemVoucher(voucher),
                        "Voucher redeemed - paid benefits activated on this device."
                      );
                  }}
                >
                  <input
                    id="voucher"
                    className="input min-w-0 flex-1"
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
        </SettingsSection>
      )}

      {/* Cloud (Pro) devices - 5 per organization, shared with the team */}
      {cloudConfigured && (
        <SettingsSection
          title="Cloud devices"
          description="Manage devices signed in to your shared cloud workspace."
        >
          <p className="text-sm text-brand-500 mt-1">
            Devices signed in to your cloud workspace - yours, employees', teammates'. Up
            to {CLOUD_DEVICE_LIMIT} at a time; release one to make room for a new device.{" "}
            {orgDevices.length}/{CLOUD_DEVICE_LIMIT} in use.
          </p>
          <ul className="divide-y divide-border">
            {orgDevices.map((d) => (
              <li
                key={d.id}
                className="py-3 text-sm flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-foreground min-w-0 break-words">
                  {d.device_name || "Device"}{" "}
                  {d.fingerprint === thisDevice && (
                    <span className="text-xs text-primary-600">(this device)</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-brand-400">
                    last seen {fmtDate(d.last_seen)}
                  </span>
                  <button
                    className="btn-ghost text-danger"
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
        </SettingsSection>
      )}

      {/* Website leads + their coupon codes — send the code after payment. */}
      {leads.length > 0 && (
        <SettingsSection
          title="Freedom leads & coupons"
          description="Manage requests for the desktop plan."
          stacked
        >
          <p className="text-sm text-brand-500 mt-1">
            Visitors who asked for the plan. Each code unlocks the offline license ONCE
            and expires unused after 30 days. Copy → send after payment.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {leads.map((l) => (
              <li
                key={l.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground break-words">
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
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs font-medium text-foreground break-all">
                    {l.code}
                  </code>
                  <button
                    aria-label="Copy code"
                    title="Copy code"
                    className="btn-ghost w-10 p-0"
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
                      className="btn-ghost text-muted-foreground"
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
        </SettingsSection>
      )}

      {(msg || err) && (
        <div className="p-5 sm:p-6">
          {msg && (
            <p role="status" className="text-sm text-success">
              {msg}
            </p>
          )}
          {err && (
            <p role="alert" className="text-sm text-danger">
              {err}
            </p>
          )}
        </div>
      )}
    </SettingsPanel>
  );
}
