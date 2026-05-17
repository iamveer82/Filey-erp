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
} from "lucide-react";
import {
  tools,
  billing,
  User,
  AuditEntry,
  CompanyProfile,
} from "../lib/api";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useModules } from "../lib/modules";
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
          {["preferences", "billing", "notifications", "integrations", "backup"].includes(
            section
          ) && (
            <Placeholder
              title={NAV.find((n) => n.id === section)?.label ?? ""}
            />
          )}
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
      setSaved(true);
    } catch (e) {
      alert(`Could not save: ${e}`);
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
              className="input"
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
              className="input"
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
              className="input"
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
                  className="input"
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
                className="input"
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
                className="input"
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
                className="input"
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
                className="input"
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

/* ---------------- Users & Roles ---------------- */

function UsersRoles() {
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => tools.users().then(setUsers).catch(console.error);
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Add User
        </button>
      </div>
      <DataTable<User>
        rows={users}
        empty="No users yet"
        columns={[
          {
            key: "u",
            label: "Username",
            render: (u) => (
              <span className="font-mono text-xs">{u.username}</span>
            ),
          },
          {
            key: "n",
            label: "Full Name",
            render: (u) => (
              <span className="font-semibold">{u.full_name}</span>
            ),
          },
          {
            key: "r",
            label: "Role",
            render: (u) => <Badge tone="info">{u.role}</Badge>,
          },
          {
            key: "s",
            label: "Status",
            render: (u) => (
              <Badge tone={u.active ? "success" : "danger"}>
                {u.active ? "active" : "disabled"}
              </Badge>
            ),
          },
          {
            key: "a",
            label: "",
            render: (u) => (
              <button
                className="btn-ghost text-xs"
                onClick={async () => {
                  await tools.toggleUser(u.id);
                  load();
                }}
              >
                {u.active ? "Disable" : "Enable"}
              </button>
            ),
          },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Add User">
        <UserForm
          onSaved={() => {
            load();
            setOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

function UserForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({
    username: "",
    full_name: "",
    role: "staff",
  });
  return (
    <div>
      <div className="space-y-3">
        <Field label="Username">
          <input
            className="input"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
          />
        </Field>
        <Field label="Full Name">
          <input
            className="input"
            value={f.full_name}
            onChange={(e) => setF({ ...f, full_name: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <select
            className="input"
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value })}
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="accountant">Accountant</option>
            <option value="staff">Staff</option>
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          className="btn-primary"
          disabled={!f.username.trim()}
          onClick={async () => {
            await tools.createUser(f.username, f.full_name, f.role);
            onSaved();
          }}
        >
          Create User
        </button>
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

/* ---------------- Placeholder sections ---------------- */

function Placeholder({ title }: { title: string }) {
  return (
    <div className="card">
      <p className="font-bold text-ink">{title}</p>
      <p className="text-sm text-brand-500 mt-2">
        {title} settings will appear here. Core configuration (company,
        users, security, activity) is available in the other sections.
      </p>
    </div>
  );
}
