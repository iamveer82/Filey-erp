import { useState } from "react";
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
  Cable,
  Activity,
  KeyRound,
} from "lucide-react";
import { PageHeader } from "../../components/ui";
import { cloudConfigured } from "../../lib/supabase";
import { cn } from "../../lib/format";
import CompanyDetails from "./CompanyDetails";
import AccountProfile from "./AccountProfile";
import AiSettings from "../../components/AiSettings";
import UsersRoles from "./UsersRoles";
import ActivityLog from "./ActivityLog";
import SecurityPanel, { ChangePasswordModal } from "./SecurityPanel";
import AppsManager from "./AppsManager";
import AppearancePanel from "./AppearancePanel";
import PreferencesPanel from "./PreferencesPanel";
import NotificationsPanel from "./NotificationsPanel";
import BillingPanel from "./BillingPanel";
import IntegrationsPanel from "./IntegrationsPanel";
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
  | "integrations"
  | "backup"
  | "datamode"
  | "activity"
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
  { id: "integrations", label: "Integrations", icon: Cable },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "datamode", label: "Data & Storage", icon: HardDrive },
  { id: "activity", label: "Activity Log", icon: Activity },
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

  return (
    <div className="animate-fade-up pb-10">
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
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] whitespace-nowrap border-b-2 transition-colors cursor-pointer",
                  isActive
                    ? "border-primary-500 text-foreground font-medium"
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
        {section === "company" && <CompanyDetails />}
        {section === "account" && <AccountProfile />}
        {section === "ai" && <AiSettings />}
        {section === "users" && <UsersRoles />}
        {section === "apps" && <AppsManager />}
        {section === "appearance" && <AppearancePanel />}
        {section === "activity" && <ActivityLog />}
        {section === "security" && (
          <SecurityPanel onChangePassword={() => setPwOpen(true)} />
        )}
        {section === "preferences" && <PreferencesPanel />}
        {section === "billing" && <BillingPanel />}
        {section === "license" && <LicensePanel />}
        {section === "notifications" && <NotificationsPanel />}
        {/* {section === "sms" && <SmsPanel />} */}
        {section === "integrations" && <IntegrationsPanel />}
        {section === "backup" && <BackupPanel />}
        {section === "datamode" && <DataModePanel />}
      </div>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
