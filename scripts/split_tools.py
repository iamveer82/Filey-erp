import os, re, subprocess, json

SRC = "src/pages/Tools.tsx"
OUT_DIR = "src/pages/settings"

os.makedirs(OUT_DIR, exist_ok=True)

with open(SRC, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Full import block (lines 1-73)
import_block = "".join(lines[:73])

sections = {
    "CompanyDetails": (264, 535),
    "AccountProfile": (537, 1006),
    "UsersRoles": (1008, 1464),
    "ActivityLog": (1466, 1580),
    "SecurityPanel": (1582, 1692),
    "AppsManager": (1694, 1748),
    "PreferencesPanel": (1750, 1868),
    "NotificationsPanel": (1870, 1909),
    "BillingPanel": (1911, 2064),
    "IntegrationsPanel": (2066, 2122),
    "BackupPanel": (2124, 2202),
    "EmailPanel": (2204, 2416),
}

# Write each section with FULL imports
for name, (start, end) in sections.items():
    body = "".join(lines[start-1:end])
    file_text = import_block + "\n" + body
    path = os.path.join(OUT_DIR, f"{name}.tsx")
    with open(path, "w", encoding="utf-8") as f:
        f.write(file_text)
    print(f"Wrote {path}")

# Write shared components file for small helpers
shared_body = "".join(lines[218:262])  # ManageRow
shared_body += "\n" + "".join(lines[539:580])  # PW_RULES + PwInput
shared_body += "\n" + "".join(lines[1752:1800])  # useSettings + Toggle
with open(os.path.join(OUT_DIR, "_shared.tsx"), "w", encoding="utf-8") as f:
    f.write(import_block + "\n" + shared_body)
print("Wrote _shared.tsx")

# Write index.tsx (main layout)
layout = import_block + "".join(lines[117:217])  # Settings component
layout = layout.replace("{section === \"company\" && <CompanyDetails />}", "{section === \"company\" && <CompanyDetails />}")
layout = layout.replace("{section === \"account\" && <AccountProfile />}", "{section === \"account\" && <AccountProfile />}")
layout = layout.replace("{section === \"ai\" && <AiSettings />}", "{section === \"ai\" && <AiSettings />}")
layout = layout.replace("{section === \"account-mgmt\" && (", "{section === \"account-mgmt\" && <div className=\"card\"><p className=\"font-bold text-ink\">Account Management</p><p className=\"text-sm text-brand-500 mt-0.5 mb-4\">Manage your account security and access settings</p></div>}")
# Actually let's write a clean layout
layout = '''import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2, UserCircle, Users as UsersIcon, SlidersHorizontal,
  CreditCard, ShieldCheck, Bell, Plug, DatabaseBackup, History, Sparkles,
} from "lucide-react";
import { PageHeader } from "../components/ui";
import CompanyDetails from "./CompanyDetails";
import AccountProfile from "./AccountProfile";
import AiSettings from "../components/AiSettings";
import UsersRoles from "./UsersRoles";
import ActivityLog from "./ActivityLog";
import SecurityPanel from "./SecurityPanel";
import AppsManager from "./AppsManager";
import PreferencesPanel from "./PreferencesPanel";
import NotificationsPanel from "./NotificationsPanel";
import BillingPanel from "./BillingPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import BackupPanel from "./BackupPanel";
import EmailPanel from "./EmailPanel";

type Section =
  | "company" | "account" | "account-mgmt" | "users" | "apps"
  | "preferences" | "billing" | "security" | "notifications"
  | "email" | "integrations" | "backup" | "activity" | "ai";

const NAV: { id: Section; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company Details", icon: Building2 },
  { id: "account", label: "Account & Profile", icon: UserCircle },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "account-mgmt", label: "Account Management", icon: ShieldCheck },
  { id: "users", label: "Users & Roles", icon: UsersIcon },
  { id: "apps", label: "Apps & Modules", icon: SlidersHorizontal },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "email", label: "Email", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "activity", label: "Activity Log", icon: History },
];

export default function Settings() {
  const [params] = useSearchParams();
  const requested = (params.get("section") ?? "") as Section;
  const [section, setSection] = useState<Section>(
    NAV.some((n) => n.id === requested) ? requested : "company"
  );

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
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-left leading-snug transition-colors cursor-pointer ${
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
          {section === "security" && <SecurityPanel />}
          {section === "preferences" && <PreferencesPanel />}
          {section === "billing" && <BillingPanel />}
          {section === "notifications" && <NotificationsPanel />}
          {section === "email" && <EmailPanel />}
          {section === "integrations" && <IntegrationsPanel />}
          {section === "backup" && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}
'''

with open(os.path.join(OUT_DIR, "index.tsx"), "w", encoding="utf-8") as f:
    f.write(layout)
print("Wrote index.tsx")

with open(SRC, "w", encoding="utf-8") as f:
    f.write('export { default } from "./settings";\n')
print("Updated Tools.tsx")
