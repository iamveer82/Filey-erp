import { useEffect, useRef, useState, type ReactNode } from "react";
import { Laptop, Smartphone, Globe } from "lucide-react";
import { SettingsSection } from "./SettingsLayout";
import { useUI } from "../lib/ui";
import {
  LINK_ACTIVITY_EVENT, forgetDevice, forgetHost, isDesktopApp, linkedDevices, myPairingCode, onDeviceLinkChange,
  pairWith, pairedHosts, setPairApprover, trustedDevices, type DeviceKind, type LinkedDevice,
} from "../lib/deviceLink";

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
const Icon = ({ kind }: { kind: DeviceKind }) =>
  kind === "desktop" ? <Laptop size={16} /> : kind === "mobile" ? <Smartphone size={16} /> : <Globe size={16} />;

/** Re-renders when devices come and go or a pairing changes. */
export function useDeviceLink(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onDeviceLinkChange(() => setVersion(v => v + 1)), []);
  return version;
}

function Row({ kind, label, status, action }: { kind: DeviceKind; label: string; status: string; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border p-3">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-hover text-muted-foreground"><Icon kind={kind} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="text-[13px] text-muted-foreground">{status}</p>
      </div>
      {action}
    </li>
  );
}

/** Settings → AI: which of this account's devices are connected. */
export function LinkedDevicesSection() {
  useDeviceLink();
  const { toast } = useUI();
  const [pairing, setPairing] = useState<{ id: string; code: string } | null>(null);
  const [error, setError] = useState("");
  const online = linkedDevices();

  if (isDesktopApp()) {
    const trusted = trustedDevices();
    return (
      <SettingsSection title="Linked devices" description="Your phone and browsers signed in to this account can run Filey AI on this computer — its model, its tools and WhatsApp, its records — after you approve them here once. Shell and computer control stay on this computer.">
        {trusted.length ? (
          <ul className="space-y-2">
            {trusted.map(d => (
              <Row key={d.id} kind={d.kind} label={d.label}
                status={`${online.some(o => o.id === d.id) ? "Online" : "Offline"} · connected ${new Date(d.pairedAt).toLocaleDateString()}`}
                action={<button type="button" className="btn-ghost" onClick={() => forgetDevice(d.id)}>Disconnect</button>} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No devices connected yet. On your phone, open Settings → AI Assistant → Linked devices and choose Connect, then approve it here.</p>
        )}
      </SettingsSection>
    );
  }

  const paired = pairedHosts();
  const hosts = online.filter(d => d.host);
  const away = Object.entries(paired).filter(([id]) => !hosts.some(h => h.id === id));
  const connect = async (host: LinkedDevice) => {
    setError("");
    try {
      setPairing({ id: host.id, code: await myPairingCode() });
      await pairWith(host);
      toast.success(`Connected. Filey AI runs on ${host.label} while it's open.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPairing(null);
    }
  };
  return (
    <SettingsSection title="Linked devices" description="Connect your computer and Filey AI runs there whenever the desktop app is open: its model, its WhatsApp, its records. Approve once on the computer; when it's closed, Filey AI runs here as usual.">
      {hosts.length || away.length ? (
        <ul className="space-y-2">
          {hosts.map(h => (
            <Row key={h.id} kind={h.kind} label={h.label}
              status={paired[h.id]
                ? `Connected · Filey AI runs here · ${h.mode === "local" ? "records on that computer" : "cloud records"}`
                : pairing?.id === h.id ? `Approve on ${h.label}. It should show ${spaced(pairing.code)}.` : "Open now · not connected"}
              action={paired[h.id]
                ? <button type="button" className="btn-ghost" onClick={() => forgetHost(h.id)}>Disconnect</button>
                : <button type="button" className="btn-ghost" disabled={!!pairing} onClick={() => void connect(h)}>{pairing?.id === h.id ? "Waiting…" : "Connect"}</button>} />
          ))}
          {away.map(([id, h]) => (
            <Row key={id} kind="desktop" label={h.label} status="Connected · offline"
              action={<button type="button" className="btn-ghost" onClick={() => forgetHost(id)}>Disconnect</button>} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No computer is open. Open the Filey desktop app, signed in to this account, to connect it.</p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </SettingsSection>
  );
}

/** Desktop, app-wide: approves new devices and says when one is using this computer. */
export function DeviceLinkHost() {
  const ui = useUI();
  // useUI() functions are recreated each render; read them through a ref.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(() => {
    if (!isDesktopApp()) return;
    const stop = setPairApprover(request => uiRef.current.confirm({
      title: `Connect ${request.label}?`,
      message: `Check that ${request.label} shows the code ${spaced(request.code)}.\n\nOnce connected it can run Filey AI on this computer: read and change your records, and send WhatsApp after approval on that device. Shell and computer control stay here. Disconnect any time in Settings → AI Assistant.`,
      confirmLabel: "Connect",
    }));
    const told = new Map<string, number>();
    const activity = (event: Event) => {
      const { device, method } = (event as CustomEvent<{ device: string; method: string }>).detail ?? {};
      if (method !== "agent.turn" || Date.now() - (told.get(device) ?? 0) < 10 * 60_000) return;
      told.set(device, Date.now());
      uiRef.current.toast.info(`${device} is using Filey AI on this computer.`);
    };
    window.addEventListener(LINK_ACTIVITY_EVENT, activity);
    return () => { stop(); window.removeEventListener(LINK_ACTIVITY_EVENT, activity); };
  }, []);
  return null;
}
