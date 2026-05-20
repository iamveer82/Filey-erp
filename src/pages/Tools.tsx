import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Upload,
  X,
  Plus,
  Lock,
  KeyRound,
  Monitor,
  Trash2,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  Pencil,
  LayoutGrid,
  Copy,
  Building,
  Download,
  Wifi,
  Mail,
  Send,
} from "lucide-react";
import {
  tools,
  billing,
  erp,
  crm,
  fin,
  quotes,
  AuditEntry,
  CompanyProfile,
  org,
  type OrgMember,
  type Organization,
} from "../lib/api";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useModules } from "../lib/modules";
import {
  loadEmailConfig,
  saveEmailConfig,
  sendEmail,
  emailShell,
  hasDesktop,
  type EmailConfig,
} from "../lib/email";
import { fmtDate } from "../lib/format";
import { PageHeader, DataTable, Badge, Modal, Field } from "../components/ui";

type Section =
  | "company"
  | "account"
  | "users"
  | "apps"
  | "preferences"
  | "billing"
  | "security"
  | "notifications"
  | "email"
  | "integrations"
  | "backup"
  | "activity";

const NAV: { id: Section; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company Details", icon: Building2 },
  { id: "account", label: "Account & Profile", icon: UserCircle },
  { id: "users", label: "Users & Roles", icon: UsersIcon },
  { id: "apps", label: "Apps & Modules", icon: LayoutGrid },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "email", label: "Email", icon: Mail },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "backup", label: "Backup & Restore", icon: DatabaseBackup },
  { id: "activity", label: "Activity Log", icon: History },
];

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "INR", "SAR"];
const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Private Limited",
  "LLC",
  "Free Zone",
  "Partnership",
  "Public Limited",
];

export default function Settings() {
  const [section, setSection] = useState<Section>("company");
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        subtitle="Manage your company details, account preferences and system settings"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr_320px] gap-4 items-start">
        {/* left sub-nav */}
        <div className="card !p-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-left transition-colors cursor-pointer ${
                section === id
                  ? "bg-primary-100 text-primary-700"
                  : "text-brand-500 hover:bg-brand-50 hover:text-ink"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* center */}
        <div className="min-w-0">
          {section === "company" && <CompanyDetails />}
          {section === "account" && <AccountProfile />}
          {section === "users" && <UsersRoles />}
          {section === "apps" && <AppsManager />}
          {section === "activity" && <ActivityLog />}
          {section === "security" && (
            <SecurityPanel onChangePassword={() => setPwOpen(true)} />
          )}
          {section === "preferences" && <PreferencesPanel />}
          {section === "billing" && <BillingPanel />}
          {section === "notifications" && <NotificationsPanel />}
          {section === "email" && <EmailPanel />}
          {section === "integrations" && <IntegrationsPanel />}
          {section === "backup" && <BackupPanel />}
        </div>

        {/* right: account management */}
        <div className="card">
          <p className="font-bold text-ink">Account Management</p>
          <p className="text-sm text-brand-500 mt-0.5 mb-4">
            Manage your account security and access settings
          </p>
          <div className="space-y-2">
            <ManageRow
              icon={<Lock size={16} />}
              title="Change Password"
              desc="Update your account password"
              onClick={() => setPwOpen(true)}
            />
            <ManageRow
              icon={<KeyRound size={16} />}
              title="Two-Factor Authentication"
              desc="Add an extra layer of security"
              right={<Badge tone="success">Available</Badge>}
              onClick={() => setSection("security")}
            />
            <ManageRow
              icon={<Monitor size={16} />}
              title="Active Sessions"
              desc="Manage your active sessions"
              onClick={() => setSection("security")}
            />
            <ManageRow
              icon={<Plug size={16} />}
              title="API Access"
              desc="Manage API keys and access"
              onClick={() => setSection("integrations")}
            />
            <ManageRow
              icon={<Trash2 size={16} />}
              title="Delete Account"
              desc="Permanently delete your account"
              danger
              onClick={() => setSection("security")}
            />
          </div>
        </div>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ManageRow({
  icon,
  title,
  desc,
  right,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  right?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl border border-brand-200 px-3 py-3 text-left hover:bg-brand-50 transition-colors cursor-pointer"
    >
      <span
        className={`rounded-lg p-2 ${
          danger
            ? "bg-danger/10 text-danger"
            : "bg-primary-100 text-primary-700"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm font-semibold ${
            danger ? "text-danger" : "text-ink"
          }`}
        >
          {title}
        </span>
        <span className="block text-[11px] text-brand-400">{desc}</span>
      </span>
      {right}
      <ChevronRight size={15} className="text-brand-300 shrink-0" />
    </button>
  );
}

/* ---------------- Company Details ---------------- */

function CompanyDetails() {
  const [c, setC] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    billing.getCompany().then(setC).catch(console.error);
  }, []);

  if (!c)
    return <div className="card text-sm text-brand-400">Loading…</div>;

  const set = <K extends keyof CompanyProfile>(
    k: K,
    v: CompanyProfile[K]
  ) => {
    setC({ ...c, [k]: v });
    setSaved(false);
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      await billing.saveCompany(c);
      try {
        const fresh = await billing.getCompany();
        setC(fresh);
      } catch {
        // getCompany falls back to cache — our saved data is there.
      }
      setSaved(true);
    } catch (e) {
      alert(
        `Could not save company details: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  const Req = () => <span className="text-danger">*</span>;

  return (
    <div className="card">
      <p className="font-bold text-ink">Company Details</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-5">
        Update your company information. These details appear on invoices,
        quotations and other documents automatically.
      </p>

      <p className="label">Company Logo</p>
      <div className="flex items-center gap-4 mb-5">
        <div className="w-24 h-24 rounded-2xl border border-brand-200 bg-brand-50 grid place-items-center overflow-hidden">
          {c.logo ? (
            <img
              src={c.logo}
              alt="logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <Building2 size={28} className="text-brand-300" />
          )}
        </div>
        <div>
          <button
            className="btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> Upload Logo
          </button>
          <p className="text-[11px] text-brand-400 mt-1">
            JPG, PNG or SVG · max 2MB
          </p>
          {c.logo && (
            <button
              className="text-[11px] font-semibold text-danger mt-1 cursor-pointer"
              onClick={() => set("logo", undefined)}
            >
              <X size={11} className="inline" /> Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onLogo(e.target.files?.[0])}
          />
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Company Name *">
          <input
            className="input"
            value={c.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Business Type">
            <select
              className="select"
              value={c.business_type ?? ""}
              onChange={(e) => set("business_type", e.target.value)}
            >
              <option value="">Select…</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <label className="label">
              TRN (Tax Registration Number) <Req />
            </label>
            <input
              className="input"
              placeholder="100000000000003"
              value={c.trn ?? ""}
              onChange={(e) => set("trn", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">
            Address <Req />
          </label>
          <input
            className="input mb-2"
            placeholder="Street, area"
            value={c.address ?? ""}
            onChange={(e) => set("address", e.target.value)}
          />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-2">
            <input
              className="input"
              placeholder="City, Country"
              value={c.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
            <input
              className="input"
              placeholder="Zip / Postal Code"
              value={c.zip ?? ""}
              onChange={(e) => set("zip", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">
              Phone Number <Req />
            </label>
            <input
              className="input"
              placeholder="+971 50 123 4567"
              value={c.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Email Address <Req />
            </label>
            <input
              className="input"
              placeholder="hello@company.com"
              value={c.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Website">
            <input
              className="input"
              placeholder="www.company.com"
              value={c.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <select
              className="select"
              value={c.currency ?? "AED"}
              onChange={(e) => set("currency", e.target.value)}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-bold text-ink">Tax Information</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Select how tax is applied to your transactions
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Tax Type">
            <select
              className="select"
              value={c.tax_type ?? "VAT"}
              onChange={(e) => set("tax_type", e.target.value)}
            >
              {["VAT", "GST", "Sales Tax", "None"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="VAT Registration Number">
            <input
              className="input"
              value={c.vat_number ?? ""}
              onChange={(e) => set("vat_number", e.target.value)}
            />
          </Field>
          <Field label="Default Tax Rate (%)">
            <input
              type="number"
              className="input"
              placeholder="5"
              value={c.default_tax_rate ?? ""}
              onChange={(e) =>
                set("default_tax_rate", +e.target.value)
              }
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6">
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
            <Check size={15} /> Saved — applied to all documents
          </span>
        )}
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Account & Profile ---------------- */

const PW_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  {
    label: "Contains uppercase and lowercase letters",
    test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p),
  },
  {
    label: "Contains a number or special character",
    test: (p: string) => /[0-9!@#$%^&*]/.test(p),
  },
];

function PwInput({
  val,
  onChange,
  shown,
  toggle,
}: {
  val: string;
  onChange: (v: string) => void;
  shown: boolean;
  toggle: () => void;
}) {
  return (
    <div className="relative">
      <input
        type={shown ? "text" : "password"}
        className="input pr-10"
        value={val}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle visibility"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 cursor-pointer"
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function AccountProfile() {
  const { profile, user, updateProfile, signInWithPassword } = useAuth();
  const [p, setP] = useState({
    name: profile?.name ?? "",
    phone: profile?.phone ?? "",
    role: profile?.role ?? "Administrator",
    username: profile?.username ?? "",
    avatar: profile?.avatar ?? "",
    language: profile?.language ?? "English (US)",
    timezone: profile?.timezone ?? "(GMT+04:00) Dubai, UAE",
    date_format: profile?.date_format ?? "DD MMM, YYYY",
    time_format: profile?.time_format ?? "12 Hour (02:30 PM)",
  });
  const set = (k: keyof typeof p, v: string) => setP({ ...p, [k]: v });
  const avatarRef = useRef<HTMLInputElement>(null);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savedPrefs, setSavedPrefs] = useState(false);

  const initials = (p.name || profile?.email || "U")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const verified = !!(user as any)?.email_confirmed_at;

  const onAvatar = (file?: File) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => set("avatar", String(r.result));
    r.readAsDataURL(file);
  };

  // ---- password ----
  const [cur, setCur] = useState("");
  const [npw, setNpw] = useState("");
  const [cpw, setCpw] = useState("");
  const [show, setShow] = useState({ c: false, n: false, k: false });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; t: string } | null>(
    null
  );
  const pwValid = PW_RULES.every((r) => r.test(npw));

  const changeEmail = async () => {
    const next = prompt("New email address?", profile?.email ?? "");
    if (!next || !supabase) return;
    const { error } = await supabase.auth.updateUser({ email: next });
    alert(
      error
        ? `Could not change email: ${error.message}`
        : "Confirmation sent to the new email address."
    );
  };

  const updatePassword = async () => {
    setPwMsg(null);
    if (!pwValid) return setPwMsg({ ok: false, t: "New password too weak." });
    if (npw !== cpw)
      return setPwMsg({ ok: false, t: "Passwords do not match." });
    if (!supabase || !profile) return;
    setPwBusy(true);
    try {
      await signInWithPassword(
        { channel: "email", value: profile.email },
        cur
      );
      const { error } = await supabase.auth.updateUser({ password: npw });
      if (error) throw error;
      setPwMsg({ ok: true, t: "Password updated." });
      setCur("");
      setNpw("");
      setCpw("");
    } catch (e: any) {
      setPwMsg({
        ok: false,
        t: e?.message ?? "Current password is incorrect.",
      });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
      {/* left column */}
      <div className="space-y-4 min-w-0">
        {/* Profile Information */}
        <div className="card">
          <div className="flex items-start justify-between mb-1 gap-3">
            <div>
              <p className="font-bold text-ink">Profile Information</p>
              <p className="text-sm text-brand-500 mt-0.5">
                Update your personal details and profile information
              </p>
            </div>
            <button
              className="btn-primary text-xs"
              onClick={async () => {
                try {
                  await updateProfile({
                    name: p.name,
                    phone: p.phone,
                    role: p.role,
                    avatar: p.avatar,
                    username: p.username,
                  });
                  setSavedProfile(true);
                  setTimeout(() => setSavedProfile(false), 2500);
                } catch (e) {
                  alert(`Could not save: ${e}`);
                }
              }}
            >
              {savedProfile ? "Saved" : "Save Changes"}
            </button>
          </div>
          <div className="flex items-start gap-5 mt-4">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-full bg-ink text-white grid place-items-center text-xl font-bold overflow-hidden">
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <button
                onClick={() => avatarRef.current?.click()}
                aria-label="Change photo"
                className="absolute -bottom-1 -right-1 rounded-full bg-primary-400 text-ink p-1.5 cursor-pointer"
              >
                <Pencil size={12} />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onAvatar(e.target.files?.[0])}
              />
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full Name *">
                <input
                  className="input"
                  value={p.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>
              <Field label="Email Address *">
                <input
                  className="input bg-brand-50"
                  value={profile?.email ?? ""}
                  disabled
                />
              </Field>
              <Field label="Phone Number">
                <input
                  className="input"
                  placeholder="+971 50 123 4567"
                  value={p.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field>
              <Field label="Role">
                <select
                  className="select"
                  value={p.role}
                  onChange={(e) => set("role", e.target.value)}
                >
                  {["Administrator", "Manager", "Accountant", "Staff"].map(
                    (r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    )
                  )}
                </select>
              </Field>
            </div>
          </div>
        </div>

        {/* Login Credentials */}
        <div className="card">
          <p className="font-bold text-ink">Login Credentials</p>
          <p className="text-sm text-brand-500 mt-0.5 mb-4">
            Manage your login email and connected methods
          </p>
          <label className="label">Login Email</label>
          <div className="flex gap-2 mb-3">
            <div className="input flex items-center justify-between">
              <span className="truncate">{profile?.email}</span>
              <Badge tone={verified ? "success" : "warn"}>
                {verified ? "Verified" : "Unverified"}
              </Badge>
            </div>
            <button className="btn-ghost shrink-0" onClick={changeEmail}>
              Change Email
            </button>
          </div>
          <label className="label">Username</label>
          <div className="flex gap-2 mb-4">
            <input
              className="input"
              placeholder="username"
              value={p.username}
              onChange={(e) => set("username", e.target.value)}
            />
            <button
              className="btn-ghost shrink-0"
              onClick={async () => {
                await updateProfile({ username: p.username });
                alert("Username saved.");
              }}
            >
              Change Username
            </button>
          </div>
          <p className="label">Connected Accounts</p>
          <p className="text-xs text-brand-400 mb-2">
            Connect your account with other services
          </p>
          {[
            { n: "Google", s: "OAuth not configured" },
            { n: "Apple", s: "OAuth not configured" },
          ].map((a) => (
            <div
              key={a.n}
              className="flex items-center justify-between rounded-xl border border-brand-200 px-3 py-2.5 mb-2"
            >
              <div>
                <p className="text-sm font-semibold text-ink">{a.n}</p>
                <p className="text-[11px] text-brand-400">{a.s}</p>
              </div>
              <button
                className="btn-ghost text-xs"
                disabled
                title="Configure the provider in Supabase Auth to enable"
              >
                Connect
              </button>
            </div>
          ))}
        </div>

        {/* Preferences */}
        <div className="card">
          <p className="font-bold text-ink">Preferences</p>
          <p className="text-sm text-brand-500 mt-0.5 mb-4">
            Manage your language, timezone and other preferences
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Language">
              <select
                className="select"
                value={p.language}
                onChange={(e) => set("language", e.target.value)}
              >
                {["English (US)", "English (UK)", "Arabic", "Hindi"].map(
                  (l) => (
                    <option key={l}>{l}</option>
                  )
                )}
              </select>
            </Field>
            <Field label="Timezone">
              <select
                className="select"
                value={p.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {[
                  "(GMT+04:00) Dubai, UAE",
                  "(GMT+00:00) UTC",
                  "(GMT+05:30) India",
                  "(GMT+01:00) Central Europe",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Date Format">
              <select
                className="select"
                value={p.date_format}
                onChange={(e) => set("date_format", e.target.value)}
              >
                {["DD MMM, YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Time Format">
              <select
                className="select"
                value={p.time_format}
                onChange={(e) => set("time_format", e.target.value)}
              >
                {["12 Hour (02:30 PM)", "24 Hour (14:30)"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex items-center justify-end gap-3 mt-4">
            {savedPrefs && (
              <span className="text-sm font-semibold text-success">
                Saved
              </span>
            )}
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await updateProfile({
                    language: p.language,
                    timezone: p.timezone,
                    date_format: p.date_format,
                    time_format: p.time_format,
                  });
                  setSavedPrefs(true);
                  setTimeout(() => setSavedPrefs(false), 2500);
                } catch (e) {
                  alert(`Could not save: ${e}`);
                }
              }}
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>

      {/* right column: Change Password */}
      <div className="card xl:sticky xl:top-2">
        <p className="font-bold text-ink">Change Password</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Update your password to keep your account secure
        </p>
        <div className="space-y-3">
          <Field label="Current Password">
            <PwInput
              val={cur}
              onChange={setCur}
              shown={show.c}
              toggle={() => setShow({ ...show, c: !show.c })}
            />
          </Field>
          <Field label="New Password">
            <PwInput
              val={npw}
              onChange={setNpw}
              shown={show.n}
              toggle={() => setShow({ ...show, n: !show.n })}
            />
          </Field>
          <ul className="space-y-1.5">
            {PW_RULES.map((r) => {
              const ok = r.test(npw);
              return (
                <li
                  key={r.label}
                  className={`flex items-center gap-2 text-xs ${
                    ok ? "text-success" : "text-brand-400"
                  }`}
                >
                  <span
                    className={`grid place-items-center w-4 h-4 rounded-full ${
                      ok
                        ? "bg-success text-white"
                        : "bg-brand-200 text-white"
                    }`}
                  >
                    <Check size={10} strokeWidth={3} />
                  </span>
                  {r.label}
                </li>
              );
            })}
          </ul>
          <Field label="Confirm New Password">
            <PwInput
              val={cpw}
              onChange={setCpw}
              shown={show.k}
              toggle={() => setShow({ ...show, k: !show.k })}
            />
          </Field>
          {pwMsg && (
            <p
              className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                pwMsg.ok
                  ? "text-success bg-success/10"
                  : "text-danger bg-danger/10"
              }`}
            >
              {pwMsg.t}
            </p>
          )}
          <button
            className="btn-primary w-full justify-center"
            disabled={pwBusy || !cur || !pwValid || npw !== cpw}
            onClick={updatePassword}
          >
            {pwBusy ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Users & Roles (Organization) ---------------- */

const ROLES = ["owner", "admin", "manager", "accountant", "staff"];

function UsersRoles() {
  const { profile, user, updateProfile } = useAuth();
  const [o, setO] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    org.get().then(setO).catch(() => {});
    org.members().then(setMembers).catch(() => {});
  };
  useEffect(load, []);

  const currentOrg = profile?.org_id || "default";
  const personal = currentOrg === "default" || !o;
  const myRole =
    members.find((m) => m.user_id === user?.id)?.role ??
    (personal ? "owner" : "staff");
  const isAdmin = personal || ["owner", "admin"].includes(myRole);

  const switchOrg = async (id: string) => {
    await updateProfile({ org_id: id });
    setName("");
    setCode("");
    setTimeout(load, 150);
  };

  const createOrg = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const id = await org.create(name.trim());
      await switchOrg(id);
    } catch (e) {
      alert(`Could not create org: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const joinOrg = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      await org.join(code.trim());
      await switchOrg(code.trim());
    } catch (e) {
      alert(`Could not join: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary-100 text-primary-700 p-2.5">
            <Building size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-ink">
              {personal ? "Personal workspace" : o?.name}
            </p>
            <p className="text-sm text-brand-500 mt-0.5">
              {personal
                ? "You're working solo. Create an organization to invite a team and share data."
                : "Share the join code below so teammates can join this organization."}
            </p>
          </div>
        </div>
        {!personal && (
          <div className="mt-4">
            <label className="label">Join code (organization ID)</label>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                readOnly
                value={currentOrg}
              />
              <button
                className="btn-ghost shrink-0"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(currentOrg)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => {});
                }}
              >
                <Copy size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <p className="font-bold text-ink mb-1">Create organization</p>
          <p className="text-xs text-brand-400 mb-3">
            You become the owner. Your current data stays in your previous
            workspace.
          </p>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Acme Trading LLC"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn-primary shrink-0"
              disabled={busy || !name.trim()}
              onClick={createOrg}
            >
              <Plus size={15} /> Create
            </button>
          </div>
        </div>
        <div className="card">
          <p className="font-bold text-ink mb-1">Join organization</p>
          <p className="text-xs text-brand-400 mb-3">
            Paste a join code (organization ID) shared with you.
          </p>
          <div className="flex gap-2">
            <input
              className="input font-mono text-xs"
              placeholder="org id…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="btn-ghost shrink-0"
              disabled={busy || !code.trim()}
              onClick={joinOrg}
            >
              Join
            </button>
          </div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="px-5 pt-4">
          <p className="font-bold text-ink">Members &amp; Roles</p>
          <p className="text-xs text-brand-400 mt-0.5 mb-3">
            {members.length} member{members.length === 1 ? "" : "s"}
            {!isAdmin && " · only owners/admins can change roles"}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-brand-400">
              <th className="px-5 py-2">Member</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Role</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-6 text-center text-sm text-brand-400"
                >
                  {personal
                    ? "Just you for now."
                    : "No members loaded."}
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.id} className="border-t border-brand-100">
                <td className="px-5 py-2.5 font-semibold text-ink">
                  {m.name}
                  {m.user_id === user?.id && (
                    <span className="text-[11px] text-brand-400">
                      {" "}
                      (you)
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-brand-600">{m.email}</td>
                <td className="px-2 py-2.5">
                  {isAdmin && m.user_id !== user?.id ? (
                    <select
                      className="select !py-1 !w-auto text-xs"
                      value={m.role}
                      onChange={async (e) => {
                        await org.setRole(m.id, e.target.value);
                        load();
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone="info">{m.role}</Badge>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {isAdmin && m.user_id !== user?.id && (
                    <button
                      aria-label="Remove member"
                      className="text-danger hover:bg-danger/10 rounded-lg p-1.5 cursor-pointer"
                      onClick={async () => {
                        await org.remove(m.id);
                        load();
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Activity Log ---------------- */

function ActivityLog() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => {
    tools.auditLog().then(setAudit).catch(console.error);
  }, []);
  return (
    <DataTable<AuditEntry>
      rows={audit}
      empty="No activity recorded"
      columns={[
        { key: "t", label: "When", render: (a) => fmtDate(a.created_at) },
        {
          key: "actor",
          label: "Actor",
          render: (a) => <span className="font-semibold">{a.actor}</span>,
        },
        {
          key: "act",
          label: "Action",
          render: (a) => <Badge tone="info">{a.action}</Badge>,
        },
        { key: "ent", label: "Entity", render: (a) => a.entity },
        { key: "d", label: "Details", render: (a) => a.details ?? "—" },
      ]}
    />
  );
}

/* ---------------- Security ---------------- */

function SecurityPanel({
  onChangePassword,
}: {
  onChangePassword: () => void;
}) {
  return (
    <div className="card">
      <p className="font-bold text-ink">Security</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Protect your account
      </p>
      <div className="space-y-2">
        <ManageRow
          icon={<Lock size={16} />}
          title="Change Password"
          desc="Update your account password"
          onClick={onChangePassword}
        />
        <ManageRow
          icon={<KeyRound size={16} />}
          title="Two-Factor Authentication"
          desc="Enable TOTP from your Supabase account settings"
        />
        <ManageRow
          icon={<Monitor size={16} />}
          title="Active Sessions"
          desc="Sessions are managed by Supabase Auth"
        />
      </div>
    </div>
  );
}

function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (open) {
      setPw("");
      setPw2("");
      setErr("");
      setOk(false);
    }
  }, [open]);

  const submit = async () => {
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords do not match.");
    if (!supabase) return setErr("Auth not configured.");
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setOk(true);
      setTimeout(onClose, 1200);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change Password">
      <div className="space-y-3">
        <Field label="New Password">
          <input
            type="password"
            className="input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </Field>
        <Field label="Confirm Password">
          <input
            type="password"
            className="input"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        </Field>
        {err && (
          <p className="text-xs font-semibold text-danger bg-danger/10 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
        {ok && (
          <p className="text-xs font-semibold text-success bg-success/10 rounded-lg px-3 py-2">
            Password updated.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Updating…" : "Update Password"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- Apps & Modules ---------------- */

function AppsManager() {
  const { modules, isEnabled, toggle } = useModules();
  return (
    <div className="card">
      <p className="font-bold text-ink">Apps &amp; Modules</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Turn modules on or off. Disabled modules are hidden from the
        sidebar and blocked. Core modules are always on.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {modules.map((m) => {
          const on = isEnabled(m.id);
          const Icon = m.icon;
          return (
            <div
              key={m.id}
              className="flex items-start gap-3 rounded-xl border border-brand-200 p-4"
            >
              <div className="rounded-xl bg-primary-100 text-primary-700 p-2.5 shrink-0">
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ink text-sm">
                    {m.label}
                  </p>
                  {m.core && <Badge tone="neutral">Core</Badge>}
                </div>
                <p className="text-xs text-brand-400 mt-0.5">{m.desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={`Toggle ${m.label}`}
                disabled={m.core}
                onClick={() => toggle(m.id)}
                className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${
                  m.core ? "cursor-not-allowed" : "cursor-pointer"
                } ${on ? "bg-primary-400" : "bg-brand-200"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                    on ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Preferences / Notifications (persisted) ------- */

function useSettings() {
  const [map, setMap] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    tools
      .settings()
      .then((rows) => {
        const m: Record<string, string> = {};
        rows.forEach((r) => (m[r.key] = r.value));
        setMap(m);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  const get = (k: string, d = "") => map[k] ?? d;
  const set = async (k: string, v: string) => {
    setMap((m) => ({ ...m, [k]: v }));
    try {
      await tools.setSetting(k, v);
    } catch {
      /* offline — queued by api layer */
    }
  };
  return { get, set, ready };
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full shrink-0 cursor-pointer transition-colors ${
        on ? "bg-primary-400" : "bg-brand-200"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function PreferencesPanel() {
  const { get, set, ready } = useSettings();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  useEffect(() => {
    billing.getCompany().then(setCompany).catch(() => {});
  }, []);
  if (!ready)
    return <div className="card text-sm text-brand-400">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="card">
        <p className="font-bold text-ink">Document defaults</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Used to pre-fill new invoices & quotations. Edit these in{" "}
          <b>Company Details</b>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {[
            ["Currency", company?.currency ?? "AED"],
            ["Invoice template", company?.default_template ?? "minimal"],
            [
              "Default tax rate",
              `${company?.default_tax_rate ?? 5}%`,
            ],
          ].map(([k, v]) => (
            <div
              key={k as string}
              className="rounded-xl border border-brand-200 p-3"
            >
              <p className="text-xs text-brand-400">{k}</p>
              <p className="font-semibold text-ink capitalize mt-0.5">
                {v}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <p className="font-bold text-ink mb-4">App preferences</p>
        <div className="space-y-3 max-w-sm">
          <Field label="Rows per page">
            <input
              type="number"
              className="input"
              placeholder="25"
              defaultValue={get("pref.page_size", "25")}
              onBlur={(e) => set("pref.page_size", e.target.value || "25")}
            />
          </Field>
          <label className="flex items-center justify-between">
            <span className="text-sm text-brand-700">
              Show KPI change indicators
            </span>
            <Toggle
              on={get("pref.kpi_delta", "on") === "on"}
              onChange={(v) => set("pref.kpi_delta", v ? "on" : "off")}
            />
          </label>
          <p className="text-[11px] text-brand-400">
            Preferences are saved to your workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

function NotificationsPanel() {
  const { get, set, ready } = useSettings();
  const ITEMS = [
    ["notif.lowstock", "Low-stock alerts", "When a product hits its reorder level"],
    ["notif.neworder", "New order received", "When a sales order is created"],
    ["notif.quote", "Quotation accepted", "When a customer accepts a quote"],
    ["notif.weekly", "Weekly summary", "A digest of activity every Monday"],
  ];
  if (!ready)
    return <div className="card text-sm text-brand-400">Loading…</div>;
  return (
    <div className="card">
      <p className="font-bold text-ink">Notifications</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Choose what you want to be notified about.
      </p>
      <div className="space-y-1">
        {ITEMS.map(([key, title, desc]) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border border-brand-200 px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="text-[11px] text-brand-400">{desc}</p>
            </div>
            <Toggle
              on={get(key, "on") === "on"}
              onChange={(v) => set(key, v ? "on" : "off")}
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-brand-400 mt-3">
        Preferences are saved now. Delivery (email/push) activates once a
        notification integration is configured.
      </p>
    </div>
  );
}

function BillingPanel() {
  const [stats, setStats] = useState<Record<string, number>>({});
  useEffect(() => {
    Promise.all([
      erp.products().catch(() => []),
      erp.orders().catch(() => []),
      quotes.listDocs().catch(() => []),
      billing.listDocs().catch(() => []),
      crm.customers().catch(() => []),
    ]).then(([p, o, q, i, c]) =>
      setStats({
        Products: p.length,
        Orders: o.length,
        Quotations: q.length,
        Invoices: i.length,
        Customers: c.length,
      })
    );
  }, []);
  return (
    <div className="space-y-4">
      <div className="card-accent">
        <p className="text-xs font-semibold text-ink/70">Current plan</p>
        <p className="text-2xl font-bold text-ink mt-1">
          Self-hosted · Free
        </p>
        <p className="text-sm text-ink/70 mt-1">
          Filey ERP is open source (MIT). Run it for your business at no
          cost — you only pay for your own Supabase project (free tier
          available).
        </p>
      </div>
      <div className="card">
        <p className="font-bold text-ink mb-3">Usage</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(stats).map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-brand-200 p-3 text-center"
            >
              <p className="text-2xl font-bold text-ink">{v}</p>
              <p className="text-[11px] text-brand-400 mt-0.5">{k}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-brand-400 mt-3">
          No usage limits — your data lives in your own Supabase project.
        </p>
      </div>
    </div>
  );
}

function IntegrationsPanel() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const rows = [
    {
      n: "Supabase",
      d: host || "not configured",
      ok: !!host,
      icon: <Wifi size={16} />,
    },
    {
      n: "Local PDF Tools",
      d: "On-device, no network",
      ok: true,
      icon: <Plug size={16} />,
    },
    {
      n: "Email / SMTP",
      d: "Not configured",
      ok: false,
      icon: <Bell size={16} />,
    },
    {
      n: "Webhooks / API",
      d: "Not configured",
      ok: false,
      icon: <Plug size={16} />,
    },
  ];
  return (
    <div className="card">
      <p className="font-bold text-ink">Integrations</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Connected services and their status.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.n}
            className="flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-3"
          >
            <span className="rounded-lg bg-primary-100 text-primary-700 p-2">
              {r.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">{r.n}</p>
              <p className="text-[11px] text-brand-400 truncate">{r.d}</p>
            </div>
            <Badge tone={r.ok ? "success" : "neutral"}>
              {r.ok ? "Connected" : "Off"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const exportData = async () => {
    setBusy(true);
    try {
      const [company, products, orders, invoices, quotations, customers, expenses] =
        await Promise.all([
          billing.getCompany().catch(() => null),
          erp.products().catch(() => []),
          erp.orders().catch(() => []),
          billing.listDocs().catch(() => []),
          quotes.listDocs().catch(() => []),
          crm.customers().catch(() => []),
          fin.expenses().catch(() => []),
        ]);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              exported_at: new Date().toISOString(),
              app: "filey-erp",
              company,
              products,
              orders,
              invoices,
              quotations,
              customers,
              expenses,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `filey-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="font-bold text-ink">Export data</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Download a JSON snapshot of your company, products, orders,
          invoices, quotations, customers and expenses.
        </p>
        <button className="btn-primary" disabled={busy} onClick={exportData}>
          <Download size={16} /> {busy ? "Preparing…" : "Export backup"}
        </button>
        {done && (
          <span className="ml-3 text-sm font-semibold text-success">
            Backup downloaded
          </span>
        )}
      </div>
      <div className="card">
        <p className="font-bold text-ink">Restore</p>
        <p className="text-sm text-brand-500 mt-2">
          Your source of truth is your Supabase project — restore from a
          Supabase backup (Dashboard → Database → Backups), or contact the
          owner to re-import an exported file. In-app restore/import is on
          the roadmap.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Email (Gmail SMTP) ---------------- */

function EmailPanel() {
  const [cfg, setCfg] = useState<EmailConfig>({
    host: "smtp.gmail.com",
    port: 587,
    username: "",
    password: "",
    from_name: "",
    from_email: "",
  });
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; msg: string }>({
    busy: false,
    msg: "",
  });
  const [c, setC] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState<{ busy: boolean; msg: string }>({
    busy: false,
    msg: "",
  });

  useEffect(() => {
    loadEmailConfig().then((v) => v && setCfg((p) => ({ ...p, ...v })));
  }, []);

  const set = (k: keyof EmailConfig, v: string | number) => {
    setCfg({ ...cfg, [k]: v });
    setSaved(false);
  };

  const save = async () => {
    const next = { ...cfg, from_email: cfg.username };
    setCfg(next);
    await saveEmailConfig(next);
    setSaved(true);
  };

  const sendTest = async () => {
    setTest({ busy: true, msg: "" });
    try {
      await saveEmailConfig({ ...cfg, from_email: cfg.username });
      await sendEmail({
        to: cfg.username,
        subject: "Filey ERP — test email",
        html: emailShell(
          "It works!",
          "<p>Your Gmail SMTP connection is configured correctly.</p>"
        ),
      });
      setTest({ busy: false, msg: "Test email sent — check your inbox." });
    } catch (e) {
      setTest({
        busy: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const compose = async () => {
    setSending({ busy: true, msg: "" });
    try {
      await sendEmail({
        to: c.to,
        subject: c.subject,
        html: emailShell(
          c.subject || "Message",
          `<p>${c.body.replace(/\n/g, "<br/>")}</p>`
        ),
      });
      setSending({ busy: false, msg: "Sent." });
      setC({ to: "", subject: "", body: "" });
    } catch (e) {
      setSending({
        busy: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="font-bold text-ink">Email connection (Gmail SMTP)</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Connect your Gmail to send invoices, quotations and alerts. Use a{" "}
          <b>Gmail App Password</b> (Google Account → Security → 2-Step
          Verification → App passwords) — not your normal password.
        </p>
        {!hasDesktop && (
          <p className="text-xs font-semibold text-warning bg-warning/10 rounded-lg px-3 py-2 mb-4">
            You can save settings here, but email is only sent from the
            Filey desktop app.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="From name">
            <input
              className="input"
              placeholder="Acme Trading"
              value={cfg.from_name}
              onChange={(e) => set("from_name", e.target.value)}
            />
          </Field>
          <Field label="Gmail address">
            <input
              className="input"
              placeholder="you@gmail.com"
              value={cfg.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>
          <Field label="App password">
            <input
              type="password"
              className="input"
              placeholder="16-character app password"
              value={cfg.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="SMTP host">
              <input
                className="input"
                value={cfg.host}
                onChange={(e) => set("host", e.target.value)}
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                className="input"
                value={cfg.port}
                onChange={(e) => set("port", +e.target.value || 587)}
              />
            </Field>
          </div>
        </div>
        <p className="text-[11px] text-brand-400 mt-2">
          Stored locally on this device — never synced to the cloud.
        </p>
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button className="btn-primary" onClick={save}>
            {saved ? "Saved" : "Save connection"}
          </button>
          <button
            className="btn-ghost"
            disabled={test.busy || !cfg.username || !cfg.password}
            onClick={sendTest}
          >
            <Send size={14} /> {test.busy ? "Sending…" : "Send test"}
          </button>
          {test.msg && (
            <span className="text-xs font-semibold text-brand-600">
              {test.msg}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <p className="font-bold text-ink mb-3">Compose &amp; send</p>
        <div className="space-y-3">
          <Field label="To">
            <input
              className="input"
              placeholder="customer@example.com"
              value={c.to}
              onChange={(e) => setC({ ...c, to: e.target.value })}
            />
          </Field>
          <Field label="Subject">
            <input
              className="input"
              value={c.subject}
              onChange={(e) => setC({ ...c, subject: e.target.value })}
            />
          </Field>
          <Field label="Message">
            <textarea
              className="textarea"
              rows={5}
              value={c.body}
              onChange={(e) => setC({ ...c, body: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={sending.busy || !c.to.trim()}
              onClick={compose}
            >
              <Send size={15} /> {sending.busy ? "Sending…" : "Send email"}
            </button>
            {sending.msg && (
              <span className="text-xs font-semibold text-brand-600">
                {sending.msg}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
