import { useEffect, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/Tabs";
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
  const [params, setParams] = useSearchParams();
  const requested = (params.get("section") ?? "") as Section;
  const section = NAV.some((n) => n.id === requested) ? requested : "company";
  const activeTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeTab.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);
  const [pwOpen, setPwOpen] = useState(false);
  const visitedRef = useRef<Set<Section>>(new Set([section]));

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        subtitle="Manage your workspace, company profile and preferences"
      />

      <Tabs value={section} onValueChange={(id) => setParams({ section: id })}>
        <div className="mb-5 min-w-0 overflow-x-auto rounded-xl border border-border bg-card p-1.5">
          <TabsList
            aria-label="Settings sections"
            className="flex w-max min-w-full gap-1 border-0 md:w-full md:flex-wrap"
          >
            {NAV.map(({ id, label, icon: Icon }) => {
              const isActive = section === id;
              return (
                <TabsTrigger
                  key={id}
                  ref={isActive ? activeTab : undefined}
                  value={id}
                  className={cn(
                    "min-h-10 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-medium",
                    "text-muted-foreground hover:bg-hover data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:after:hidden"
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-background")}
                    strokeWidth={1.75}
                  />
                  <span>{label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <div className="min-w-0">
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
              {
                id: "security",
                el: <SecurityPanel onChangePassword={() => setPwOpen(true)} />,
              },
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
                <TabsContent
                  key={id}
                  value={id}
                  forceMount
                  className="mt-0"
                  style={{ display: section === id ? "block" : "none" }}
                >
                  {el}
                </TabsContent>
              );
            });
          })()}
        </div>
      </Tabs>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
