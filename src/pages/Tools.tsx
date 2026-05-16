import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { tools, User, Setting, AuditEntry } from "../lib/api";
import { fmtDate } from "../lib/format";
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
} from "../components/ui";

type Tab = "users" | "settings" | "audit";

const UAE_SETTING_HINTS: Record<string, string> = {
  company_name: "Legal entity name on invoices",
  currency: "Base currency (AED)",
  trn: "15-digit UAE Tax Registration Number",
  vat_rate: "Standard UAE VAT (0.05)",
  fiscal_year_start: "MM-DD",
  theme: "light / dark",
};

export default function Tools() {
  const [tab, setTab] = useState<Tab>("users");
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
    <div>
      <PageHeader
        title="Tools"
        subtitle="Users, system settings & audit trail"
        action={
          tab === "users" && (
            <button className="btn-cta" onClick={() => setUserModal(true)}>
              <Plus size={16} /> Add User
            </button>
          )
        }
      />

      <div className="flex gap-2 mb-5">
        {(["users", "settings", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize transition-colors duration-200 cursor-pointer ${
              tab === t
                ? "bg-brand-500 text-white"
                : "bg-white text-brand-600 hover:bg-brand-50 border border-brand-100"
            }`}
          >
            {t === "audit" ? "Audit Log" : t}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <DataTable<User>
          rows={users}
          columns={[
            { key: "u", label: "Username", render: (u) => <span className="font-mono text-xs">{u.username}</span> },
            { key: "n", label: "Full Name", render: (u) => <span className="font-semibold">{u.full_name}</span> },
            { key: "r", label: "Role", render: (u) => <Badge tone="info">{u.role}</Badge> },
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

      {tab === "settings" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settings.map((s) => (
            <SettingCard key={s.key} setting={s} onSaved={load} />
          ))}
          <div className="bento-card border-dashed">
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
            { key: "t", label: "When", render: (a) => fmtDate(a.created_at) },
            { key: "actor", label: "Actor", render: (a) => <span className="font-semibold">{a.actor}</span> },
            { key: "act", label: "Action", render: (a) => <Badge tone="info">{a.action}</Badge> },
            { key: "ent", label: "Entity", render: (a) => a.entity },
            { key: "d", label: "Details", render: (a) => a.details ?? "—" },
          ]}
        />
      )}

      <Modal open={userModal} onClose={() => setUserModal(false)} title="Add User">
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
    <div className="bento-card">
      <div className="flex items-center justify-between">
        <p className="font-bold text-ink text-sm">{setting.key}</p>
        <code className="text-[11px] text-brand-400">key</code>
      </div>
      <p className="text-xs text-brand-400 mt-0.5 mb-2">
        {UAE_SETTING_HINTS[setting.key] ?? "Custom setting"}
      </p>
      <div className="flex gap-2">
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} />
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
      <input className="input" placeholder="key (e.g. trn)" value={k} onChange={(e) => setK(e.target.value)} />
      <input className="input" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
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
  const [f, setF] = useState({ username: "", full_name: "", role: "staff" });
  return (
    <div>
      <div className="space-y-3">
        <Field label="Username">
          <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="Full Name">
          <input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
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
