import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  UserCircle,
  Users as UsersIcon,
  SlidersHorizontal,
  CreditCard,
  Bell,
  DatabaseBackup,
  Sparkles,
  HardDrive,
  Grid3x3,
  Palette,
  Lock,
  Activity,
  KeyRound,
  Stethoscope,
} from "lucide-react";
import { PageHeader } from "../../components/ui";
import { cloudConfigured } from "../../lib/supabase";
import { cn } from "../../lib/format";
import CompanyDetails from "./CompanyDetails";
import AccountProfile from "./AccountProfile";
import AiSettings from "../../components/AiSettings";
import UsersRoles from "./UsersRoles";
import ActivityLog from "./ActivityLog";
import DiagnosticsPanel from "./DiagnosticsPanel";
import SecurityPanel, { ChangePasswordModal } from "./SecurityPanel";
import AppsManager from "./AppsManager";
import AppearancePanel from "./AppearancePanel";
import PreferencesPanel from "./PreferencesPanel";
import NotificationsPanel from "./NotificationsPanel";
import BillingPanel from "./BillingPanel";
import BackupPanel from "./BackupPanel";
import DataModePanel from "./DataModePanel";
import LicensePanel from "./LicensePanel";
// import { MessageSquare } from "lucide-react";

type Section =
  | "company"
  | "account"
  | "users"
  | "apps"
  | "appearance"
  | "preferences"
  | "billing"
  | "security"
  | "notifications"
  | "sms"
  | "backup"
  | "datamode"
  | "activity"
  | "diagnostics"
  | "ai"
  | "license";

const ALL_NAV: { id: Section; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company Details", icon: Building2 },
  { id: "account", label: "Account & Profile", icon: UserCircle },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "users", label: "Users & Roles", icon: UsersIcon },
  { id: "apps", label: "Apps & Modules", icon: Grid3x3 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard },
  { id: "license", label: "Desktop License", icon: KeyRound },
  { id: "security", label: "Security", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  // { id: "sms", label: "SMS", icon: MessageSquare },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "datamode", label: "Data & Storage", icon: HardDrive },
  { id: "activity", label: "Activity Log", icon: Activity },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
];

// Offline edition has no cloud account/org/billing — hide those tabs so the
// user never lands on a panel of dead/erroring controls.
const CLOUD_ONLY = new Set<Section>(["users", "billing", "security"]);
const NAV = ALL_NAV.filter((n) => cloudConfigured || !CLOUD_ONLY.has(n.id));

export default function Settings() {
  const [params] = useSearchParams();
  const requested = (params.get("section") ?? "") as Section;
  const [section, setSection] = useState<Section>(
    NAV.some((n) => n.id === requested) ? requested : "company"
  );
  const [pwOpen, setPwOpen] = useState(false);
  const visitedRef = useRef<Set<Section>>(new Set([section]));

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        subtitle="Manage your workspace, company profile and preferences"
      />

      {/* Horizontal section tabs (reference Settings nav) */}
      <div className="border-b border-border mb-5">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mb-px">
          {NAV.map(({ id, label, icon: Icon }) => {
            const isActive = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer",
                  isActive
                    ? "border-primary-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    isActive && "text-primary-600 dark:text-primary-400"
                  )}
                  strokeWidth={1.75}
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {(() => {
          // Keep visited panels mounted but hidden — a user who filled 15
          // fields in Company Details and clicks "Appearance" loses everything
          // if the panel unmounts. Once a panel is opened it stays alive (just
          // display:none) so form state, scroll position and in-flight saves
          // all survive tab switches. First visit still lazy-mounts.
          const PANELS: { id: Section; el: React.ReactNode }[] = [
            { id: "company", el: <CompanyDetails /> },
            { id: "account", el: <AccountProfile /> },
            { id: "ai", el: <AiSettings /> },
            { id: "users", el: <UsersRoles /> },
            { id: "apps", el: <AppsManager /> },
            { id: "appearance", el: <AppearancePanel /> },
            { id: "activity", el: <ActivityLog /> },
            { id: "diagnostics", el: <DiagnosticsPanel /> },
            { id: "security", el: <SecurityPanel onChangePassword={() => setPwOpen(true)} /> },
            { id: "preferences", el: <PreferencesPanel /> },
            { id: "billing", el: <BillingPanel /> },
            { id: "license", el: <LicensePanel /> },
            { id: "notifications", el: <NotificationsPanel /> },
            { id: "backup", el: <BackupPanel /> },
            { id: "datamode", el: <DataModePanel /> },
          ];
          return PANELS.map(({ id, el }) => {
            const visited = visitedRef.current.has(id);
            if (section === id) visitedRef.current.add(id);
            if (!visited && section !== id) return null;
            return (
              <div key={id} style={{ display: section === id ? "block" : "none" }}>
                {el}
              </div>
            );
          });
        })()}
      </div>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
