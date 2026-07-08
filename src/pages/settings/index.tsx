import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  UserCircle,
  Users as UsersIcon,
  SlidersHorizontal,
  CreditCard,
  ShieldCheck,
  Bell,
  Plug,
  DatabaseBackup,
  History,
  Sparkles,
  HardDrive,
} from "lucide-react";
import { PageHeader } from "../../components/ui";
import { cloudConfigured } from "../../lib/supabase";
import CompanyDetails from "./CompanyDetails";
import AccountProfile from "./AccountProfile";
import AiSettings from "../../components/AiSettings";
import UsersRoles from "./UsersRoles";
import ActivityLog from "./ActivityLog";
import SecurityPanel, { ChangePasswordModal } from "./SecurityPanel";
import AppsManager from "./AppsManager";
import PreferencesPanel from "./PreferencesPanel";
import NotificationsPanel from "./NotificationsPanel";
import BillingPanel from "./BillingPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import BackupPanel from "./BackupPanel";
import DataModePanel from "./DataModePanel";
import EmailPanel from "./EmailPanel";
import LicensePanel from "./LicensePanel";
import { KeyRound } from "lucide-react";
// import { MessageSquare } from "lucide-react";

type Section =
  | "company"
  | "account"
  | "account-mgmt"
  | "users"
  | "apps"
  | "preferences"
  | "billing"
  | "security"
  | "notifications"
  | "email"
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
  { id: "account-mgmt", label: "Account Management", icon: ShieldCheck },
  { id: "users", label: "Users & Roles", icon: UsersIcon },
  { id: "apps", label: "Apps & Modules", icon: SlidersHorizontal },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard },
  { id: "license", label: "Desktop License", icon: KeyRound },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "email", label: "Email", icon: Bell },
  // { id: "sms", label: "SMS", icon: MessageSquare },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "datamode", label: "Data & Storage", icon: HardDrive },
  { id: "activity", label: "Activity Log", icon: History },
];

// Offline edition has no cloud account/org/billing — hide those tabs so the
// user never lands on a panel of dead/erroring controls.
const CLOUD_ONLY = new Set<Section>(["account-mgmt", "users", "billing", "security"]);
const NAV = ALL_NAV.filter((n) => cloudConfigured || !CLOUD_ONLY.has(n.id));

export default function Settings() {
  const [params] = useSearchParams();
  const requested = (params.get("section") ?? "") as Section;
  const [section, setSection] = useState<Section>(
    NAV.some((n) => n.id === requested) ? requested : "company"
  );
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        subtitle="Manage your company details, account preferences and system settings"
      />
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        <nav className="card !p-2 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-left leading-snug transition-colors cursor-pointer ${
                section === id
                  ? "bg-primary-100 text-primary-700"
                  : "text-brand-500 hover:bg-brand-50 hover:text-ink"
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1 min-w-0 truncate">{label}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "company" && <CompanyDetails />}
          {section === "account" && <AccountProfile />}
          {section === "ai" && <AiSettings />}
          {section === "account-mgmt" && <AccountProfile />}
          {section === "users" && <UsersRoles />}
          {section === "apps" && <AppsManager />}
          {section === "activity" && <ActivityLog />}
          {section === "security" && (
            <SecurityPanel onChangePassword={() => setPwOpen(true)} />
          )}
          {section === "preferences" && <PreferencesPanel />}
          {section === "billing" && <BillingPanel />}
          {section === "license" && <LicensePanel />}
          {section === "notifications" && <NotificationsPanel />}
          {section === "email" && <EmailPanel />}
          {/* {section === "sms" && <SmsPanel />} */}
          {section === "integrations" && <IntegrationsPanel />}
          {section === "backup" && <BackupPanel />}
          {section === "datamode" && <DataModePanel />}
        </div>
      </div>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
