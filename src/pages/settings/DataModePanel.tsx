import { Cloud, HardDrive, Check } from "lucide-react";
import { getDataMode, setDataMode, type DataMode } from "../../lib/dataMode";
import { cloudConfigured } from "../../lib/supabase";

// Switch where data lives. Changing mode reloads the app; it does NOT migrate
// data — local data stays on this device, cloud data stays in your account.
export default function DataModePanel() {
  const mode: DataMode = getDataMode() ?? (cloudConfigured ? "cloud" : "local");

  const switchTo = (m: DataMode) => {
    if (m === mode) return;
    if (m === "cloud" && !cloudConfigured) return;
    setDataMode(m);
    window.location.reload();
  };

  const Card = ({
    m,
    icon: Icon,
    title,
    desc,
    disabled,
  }: {
    m: DataMode;
    icon: typeof Cloud;
    title: string;
    desc: string;
    disabled?: boolean;
  }) => {
    const active = mode === m;
    return (
      <button
        onClick={() => switchTo(m)}
        disabled={disabled}
        className={`w-full text-left rounded-2xl border p-4 transition ${
          active
            ? "border-primary-400 bg-primary-50"
            : "border-brand-200 hover:border-brand-300"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-ink p-2.5 text-white">
            <Icon size={20} />
          </div>
          <div className="flex-1">
            <p className="font-medium text-ink flex items-center gap-2">
              {title}
              {active && (
                <span className="inline-flex items-center gap-1 text-xs text-primary-600">
                  <Check size={14} /> Active
                </span>
              )}
            </p>
            <p className="text-sm text-brand-500 mt-0.5">{desc}</p>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-medium text-ink">Data & Storage</h2>
        <p className="text-sm text-brand-500 mt-1">
          Choose where Filey keeps your data. Switching reloads the app and does
          not move existing data between local and cloud.
        </p>
      </div>
      <div className="space-y-3">
        <Card
          m="local"
          icon={HardDrive}
          title="Offline (this device)"
          desc="Everything stored on this computer. No account, no internet, never leaves the machine."
        />
        <Card
          m="cloud"
          icon={Cloud}
          title="Cloud sync"
          desc={
            cloudConfigured
              ? "Stored in your Supabase account and synced across devices."
              : "Not available — Supabase isn't configured in this build."
          }
          disabled={!cloudConfigured}
        />
      </div>
    </div>
  );
}
