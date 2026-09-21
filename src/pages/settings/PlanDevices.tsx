import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsSection } from "../../components/SettingsLayout";
import { useUI } from "../../lib/ui";
import { supabase } from "../../lib/supabase";
import { fmtDate } from "../../lib/format";
import {
  activateThisDevice,
  collectPurchases,
  deactivateDevice,
  deviceId,
  licenseOverview,
  listOrgDevices,
  releaseOrgDevice,
  verifyStoredLicense,
  LITE_DEVICE_LIMIT,
  type OrgDevice,
} from "../../lib/license";

/** Signed-in devices and plan slots; activation is automatic. */
export default function PlanDevices() {
  const { confirm } = useUI();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [overview, setOverview] =
    useState<Awaited<ReturnType<typeof licenseOverview>>>(null);
  const [devices, setDevices] = useState<OrgDevice[]>([]),
    [current, setCurrent] = useState("");
  const [active, setActive] = useState(false),
    [loaded, setLoaded] = useState(false);
  const revision = useRef(0);
  const accountId = useRef<string | null | undefined>(undefined);
  const [accountVersion, setAccountVersion] = useState(0);
  useEffect(() => {
    const listener = supabase?.auth.onAuthStateChange((event, session) => {
      if (!["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"].includes(event)) return;
      const id = session?.user.id ?? null;
      if (accountId.current === id) return;
      const initial = accountId.current === undefined;
      accountId.current = id;
      if (initial && event === "INITIAL_SESSION") return;
      revision.current++;
      setOverview(null);
      setDevices([]);
      setLoaded(false);
      setAccountVersion((version) => version + 1);
      setBusy(false);
      setActive(false);
      setError("");
    });
    const invalidate = () => {
      revision.current++;
    };
    return () => {
      invalidate();
      listener?.data.subscription.unsubscribe();
    };
  }, []);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const version = revision.current;
    try {
      if (!supabase || !(await supabase.auth.getSession()).data.session)
        throw new Error("Sign in to your Filey account to manage your devices.");
      const changed = await collectPurchases();
      const [owned, cloud, id, local] = await Promise.all([
        licenseOverview(),
        listOrgDevices(),
        deviceId(),
        verifyStoredLicense(),
      ]);
      if (version !== revision.current) return;
      setOverview(owned);
      setDevices(cloud);
      setCurrent(id);
      setActive(local.valid);
      setLoaded(true);
      if (changed) window.dispatchEvent(new Event("filey:entitlement"));
    } catch {
      if (version === revision.current)
        setError(
          "We couldn’t load your devices. Sign in to your Filey account and check your connection."
        );
    } finally {
      if (version === revision.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, accountVersion]);
  async function remove(name: string, work: () => Promise<void>) {
    const version = revision.current;
    if (
      !(await confirm({
        title: `Remove ${name}?`,
        message:
          "This frees its plan slot. It does not delete the device’s records. Offline access already saved on another device may remain until it reconnects.",
        confirmLabel: "Remove device",
        danger: true,
      }))
    )
      return;
    if (version !== revision.current) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch {
      if (version === revision.current)
        setError("We couldn’t remove this device. Please try again shortly.");
    } finally {
      if (version === revision.current) setBusy(false);
    }
  }
  return (
    <SettingsSection
      title="Devices"
      description="Plan benefits are applied when you sign in. Manage your device slots here."
    >
      <div className="space-y-4">
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Checking devices…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {loaded && (
          <>
            <p className="text-sm text-muted-foreground">
              {active
                ? "Ultra is active on this device, including offline access."
                : overview
                  ? "Your account owns Ultra. Access on this device depends on your available device slots."
                  : "Your purchased plan follows your Filey account. Basic also includes local storage and core offline tools."}
            </p>
            {overview && (
              <div>
                <p className="text-sm font-medium">
                  Ultra devices ·{" "}
                  {overview.devices.filter((d) => !d.deactivated_at).length} /{" "}
                  {LITE_DEVICE_LIMIT}
                </p>
                <ul className="divide-y divide-border">
                  {overview.devices
                    .filter((d) => !d.deactivated_at)
                    .map((d) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                        key={d.fingerprint}
                      >
                        <span>
                          {d.device_name || "Device"}
                          {d.fingerprint === current && " · This device"}
                        </span>
                        <button
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() =>
                            void remove(d.device_name || "device", () =>
                              deactivateDevice(d.fingerprint)
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                </ul>
                {!active && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const state = await activateThisDevice();
                        if (!state.valid) throw new Error();
                        await load();
                      } catch {
                        setError(
                          "Access could not be restored. If both slots are used, remove an old device first."
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Restore access on this device
                  </button>
                )}
              </div>
            )}
            {devices.length > 0 && (
              <div>
                <p className="text-sm font-medium">Workspace devices</p>
                <ul className="divide-y divide-border">
                  {devices.map((d) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                      key={d.id}
                    >
                      <div>
                        {d.device_name || "Device"}
                        {d.fingerprint === current && " · This device"}
                        <p className="text-xs text-muted-foreground">
                          Last used {fmtDate(d.last_seen)}
                        </p>
                      </div>
                      <button
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void remove(d.device_name || "device", () =>
                            releaseOrgDevice(d.id)
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <button className="btn-ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          Refresh devices
        </button>
      </div>
    </SettingsSection>
  );
}
