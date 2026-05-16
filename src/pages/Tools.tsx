import { useEffect, useRef, useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import {
  tools,
  billing,
  User,
  Setting,
  AuditEntry,
  CompanyProfile,
} from "../lib/api";
import { fmtDate } from "../lib/format";
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
} from "../components/ui";
import PdfToolbox from "../components/PdfToolbox";

type Tab = "company" | "pdf" | "users" | "system" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "Company Details" },
  { id: "pdf", label: "PDF Tools" },
  { id: "users", label: "Users" },
  { id: "system", label: "System" },
  { id: "audit", label: "Audit Log" },
];

const UAE_SETTING_HINTS: Record<string, string> = {
  company_name: "Legal entity name on invoices",
  currency: "Base currency (AED)",
  trn: "15-digit UAE Tax Registration Number",
  vat_rate: "Standard UAE VAT (0.05)",
  fiscal_year_start: "MM-DD",
  theme: "light / dark",
};

const INVOICE_TEMPLATES = [
  "minimal",
  "classic",
  "modern",
  "corporate",
  "elegant",
  "bold",
  "tech",
  "creative",
  "receipt",
  "monogram",
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("company");
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [userModal, setUserModal] = useState(false);

  const load = () => {
    tools.users().then(setUsers).catch(console.error);
    tools.settings().then(setSettings).catch(console.error);
    tools.auditLog().then(setAudit).catch(console.error);
  };
  useEffect(load, []);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        subtitle="Company profile, document tools, users & audit trail"
        action={
          tab === "users" && (
            <button className="btn-primary" onClick={() => setUserModal(true)}>
              <Plus size={16} /> Add User
            </button>
          )
        }
      />

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`chip ${tab === t.id ? "chip-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && <CompanyDetails />}

      {tab === "pdf" && <PdfToolbox />}

      {tab === "users" && (
        <DataTable<User>
          rows={users}
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
      )}

      {tab === "system" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settings.map((s) => (
            <SettingCard key={s.key} setting={s} onSaved={load} />
          ))}
          <div className="card border-dashed">
            <p className="font-bold text-ink text-sm">Add UAE Setting</p>
            <p className="text-xs text-brand-400 mt-1 mb-3">
              e.g. <code>trn</code> = your 15-digit Tax Registration Number
            </p>
            <NewSetting onSaved={load} />
          </div>
        </div>
      )}

      {tab === "audit" && (
        <DataTable<AuditEntry>
          rows={audit}
          columns={[
            {
              key: "t",
              label: "When",
              render: (a) => fmtDate(a.created_at),
            },
            {
              key: "actor",
              label: "Actor",
              render: (a) => (
                <span className="font-semibold">{a.actor}</span>
              ),
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
      )}

      <Modal
        open={userModal}
        onClose={() => setUserModal(false)}
        title="Add User"
      >
        <UserForm
          onSaved={() => {
            load();
            setUserModal(false);
          }}
        />
      </Modal>
    </div>
  );
}

/* ---------------- Company Details ---------------- */

function CompanyDetails() {
  const [c, setC] = useState<CompanyProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    billing.getCompany().then(setC).catch(console.error);
  }, []);

  if (!c)
    return (
      <div className="card text-sm text-brand-400">Loading company…</div>
    );

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <p className="font-bold text-ink mb-1">Company Details</p>
        <p className="text-sm text-brand-500 mb-5">
          Saved here once — your logo and these details are placed
          automatically on every invoice template.
        </p>

        <div className="space-y-3">
          <Field label="Company Name">
            <input
              className="input"
              value={c.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Address">
            <textarea
              className="input"
              rows={2}
              value={c.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input
                className="input"
                value={c.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label="Phone Number">
              <input
                className="input"
                value={c.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TRN / Tax No.">
              <input
                className="input"
                value={c.trn ?? ""}
                onChange={(e) => set("trn", e.target.value)}
              />
            </Field>
            <Field label="Default Accent">
              <input
                type="color"
                className="input h-[38px] p-1"
                value={c.default_accent}
                onChange={(e) => set("default_accent", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Default Invoice Template">
            <select
              className="input"
              value={c.default_template}
              onChange={(e) => set("default_template", e.target.value)}
            >
              {INVOICE_TEMPLATES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            className="btn-primary"
            disabled={saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save Company Details"}
          </button>
          {saved && (
            <span className="text-sm font-semibold text-success">
              Saved — applied to all invoices
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <p className="font-bold text-ink mb-1">Company Logo</p>
        <p className="text-sm text-brand-500 mb-4">
          Auto-placed on invoice headers.
        </p>
        <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50 p-6 grid place-items-center">
          {c.logo ? (
            <img
              src={c.logo}
              alt="Company logo"
              className="max-h-28 object-contain"
            />
          ) : (
            <p className="text-xs text-brand-400">No logo uploaded</p>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            className="btn-ghost flex-1 justify-center"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> {c.logo ? "Replace" : "Upload"}
          </button>
          {c.logo && (
            <button
              className="btn-ghost"
              onClick={() => set("logo", undefined)}
            >
              <X size={14} />
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
    </div>
  );
}

/* ---------------- System settings ---------------- */

function SettingCard({
  setting,
  onSaved,
}: {
  setting: Setting;
  onSaved: () => void;
}) {
  const [v, setV] = useState(setting.value);
  const dirty = v !== setting.value;
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="font-bold text-ink text-sm">{setting.key}</p>
        <code className="text-[11px] text-brand-400">key</code>
      </div>
      <p className="text-xs text-brand-400 mt-0.5 mb-2">
        {UAE_SETTING_HINTS[setting.key] ?? "Custom setting"}
      </p>
      <div className="flex gap-2">
        <input
          className="input"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={!dirty}
          onClick={async () => {
            await tools.setSetting(setting.key, v);
            onSaved();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function NewSetting({ onSaved }: { onSaved: () => void }) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder="key (e.g. trn)"
        value={k}
        onChange={(e) => setK(e.target.value)}
      />
      <input
        className="input"
        placeholder="value"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="btn-primary w-full justify-center"
        disabled={!k.trim()}
        onClick={async () => {
          await tools.setSetting(k.trim(), v);
          setK("");
          setV("");
          onSaved();
        }}
      >
        Add Setting
      </button>
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
