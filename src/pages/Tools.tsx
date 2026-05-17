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
import { fmtDate } from "../lib/format";
import { PageHeader, DataTable, Badge, Modal, Field } from "../components/ui";

type Section =
  | "company"
  | "account"
  | "users"
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

function AccountProfile() {
  const { profile, updateProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <div className="card">
      <p className="font-bold text-ink">Account &amp; Profile</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-5">
        Your personal account details
      </p>
      <div className="space-y-4 max-w-md">
        <Field label="Full Name">
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDone(false);
            }}
          />
        </Field>
        <Field label="Company">
          <input
            className="input"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setDone(false);
            }}
          />
        </Field>
        <Field label="Email">
          <input
            className="input bg-brand-50"
            value={profile?.email ?? ""}
            disabled
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await updateProfile({ name, company });
                setDone(true);
              } catch (e) {
                alert(`Could not save: ${e}`);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
          {done && (
            <span className="text-sm font-semibold text-success">Saved</span>
          )}
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
