import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Mail, Tags } from "lucide-react";
import { useUI } from "../lib/ui";
import { PageHeader, MetricCard, DataTable, Modal, Field, Badge } from "../components/ui";
import { tools } from "../lib/api";

const TMPL_KEY = "filey_email_templates";
/** Mirror key in Supabase (app_settings) for cross-device sync. */
const SETTING_KEY = "email_templates";

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  category: string;
  created_at: string;
}

function load(): EmailTemplate[] {
  try {
    try { return JSON.parse(localStorage.getItem(TMPL_KEY) || "[]"); } catch { return []; }
  } catch (e) {
    console.warn("Failed to load email templates", e);
    return [];
  }
}
function save(t: EmailTemplate[]) {
  try {
    localStorage.setItem(TMPL_KEY, JSON.stringify(t));
  } catch (e) {
    console.warn("Failed to save email templates", e);
  }
  // Write-through to Supabase so templates follow the user across devices.
  void tools.setSetting(SETTING_KEY, JSON.stringify(t)).catch((e) => console.warn("Failed to sync email templates to server", e));
}

/** Pull email templates saved on other devices; remote wins when present. */
async function syncEmailTemplates(): Promise<EmailTemplate[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === SETTING_KEY);
    if (row?.value) {
      const remote: EmailTemplate[] = JSON.parse(row.value);
      localStorage.setItem(TMPL_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch (e) {
    console.warn("Failed to sync email templates from server", e);
    /* offline / not configured — fall back to local */
  }
  return load();
}

const CATEGORIES = [
  "Invoice",
  "Quote",
  "Payment Receipt",
  "Follow-up",
  "Welcome",
  "General",
];

const DEFAULT_TEMPLATES: Omit<EmailTemplate, "id" | "created_at">[] = [
  {
    name: "Invoice Due",
    subject: "Invoice {{number}} from {{company}}",
    body: "Dear {{customer}},\n\nYour invoice {{number}} for {{amount}} is due on {{due_date}}.\n\nPlease make payment at your earliest convenience.\n\nThank you,\n{{company}}",
    category: "Invoice",
  },
  {
    name: "Payment Received",
    subject: "Payment Received — Receipt {{number}}",
    body: "Dear {{customer}},\n\nWe have received your payment of {{amount}}.\n\nReceipt: {{number}}\nDate: {{date}}\n\nThank you for your business.\n{{company}}",
    category: "Payment Receipt",
  },
  {
    name: "Quote Follow-up",
    subject: "Following up on Quote {{number}}",
    body: "Dear {{customer}},\n\nI hope this email finds you well. I wanted to follow up on Quote {{number}} sent on {{date}}.\n\nPlease let us know if you have any questions.\n\nBest regards,\n{{company}}",
    category: "Follow-up",
  },
];

function seedDefaults(existing: EmailTemplate[]) {
  if (existing.length > 0) return existing;
  const seeded = DEFAULT_TEMPLATES.map((t, i) => ({
    ...t,
    id: Date.now() + i + 1,
    created_at: new Date().toISOString(),
  }));
  save(seeded);
  return seeded;
}

export default function EmailTemplates() {
  const { toast, confirm } = useUI();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EmailTemplate | null>(null);
  useEffect(() => {
    syncEmailTemplates().then((t) => setTemplates(seedDefaults(t)));
  }, []);

  const del = async (t: EmailTemplate) => {
    const ok = await confirm({
      title: "Delete template",
      message: `Delete "${t.name}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const next = templates.filter((x) => x.id !== t.id);
    setTemplates(next);
    save(next);
    toast.success("Deleted.");
  };

  const duplicate = (t: EmailTemplate) => {
    const copy = {
      ...t,
      id: Date.now(),
      name: `${t.name} (copy)`,
      created_at: new Date().toISOString(),
    };
    const next = [...templates, copy];
    setTemplates(next);
    save(next);
    toast.success("Duplicated.");
  };

  const categories = new Set(templates.map((t) => t.category)).size;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Email Templates"
        subtitle="Reusable email templates with placeholders"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> New Template
          </button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 joined-kpis mb-6">
        <MetricCard
          label="Templates"
          value={String(templates.length)}
          icon={<Mail size={20} />}
        />
        <MetricCard
          label="Categories"
          value={String(categories)}
          icon={<Tags size={20} />}
          iconClass="bg-secondary/20 text-ink"
        />
      </div>
      <DataTable<EmailTemplate>
        rows={templates}
        empty="No templates yet"
        columns={[
          {
            key: "name",
            label: "Template",
            sortValue: (t) => t.name,
            render: (t) => <span className="font-medium text-ink">{t.name}</span>,
          },
          {
            key: "cat",
            label: "Category",
            sortValue: (t) => t.category,
            render: (t) => <Badge tone="info">{t.category}</Badge>,
          },
          {
            key: "subj",
            label: "Subject",
            render: (t) => (
              <span className="text-sm text-brand-500 truncate max-w-[300px] block">
                {t.subject}
              </span>
            ),
          },
          {
            key: "act",
            label: "",
            render: (t) => (
              <div className="flex items-center gap-1">
                <button
                  aria-label={`Duplicate ${t.name}`}
                  className="text-brand-500 hover:bg-brand-100 rounded-xl p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => duplicate(t)}
                >
                  <Copy size={15} />
                </button>
                <button
                  aria-label={`Delete ${t.name}`}
                  className="text-danger hover:bg-danger/10 rounded-xl p-1.5 cursor-pointer transition-colors duration-200"
                  onClick={() => del(t)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      {open && (
        <TemplateModal
          open={open}
          edit={edit}
          onClose={() => setOpen(false)}
          onSaved={(t) => {
            const next = edit
              ? templates.map((x) => (x.id === t.id ? t : x))
              : [
                  ...templates,
                  { ...t, id: Date.now(), created_at: new Date().toISOString() },
                ];
            setTemplates(next);
            save(next);
            setOpen(false);
            toast.success(edit ? "Updated." : "Template added.");
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  open,
  edit,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: EmailTemplate | null;
  onClose: () => void;
  onSaved: (t: EmailTemplate) => void;
}) {
  const [f, setF] = useState(
    edit ||
      ({ name: "", subject: "", body: "", category: "General" } as Omit<
        EmailTemplate,
        "id" | "created_at"
      >)
  );
  const valid = f.name.trim() && f.subject.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Template" : "New Template"}
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Template Name *">
            <input
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Payment Reminder"
            />
          </Field>
          <Field label="Category">
            <select
              className="select"
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Subject *">
          <input
            className="input"
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })}
            placeholder="Invoice {{number}} from {{company}}"
          />
        </Field>
        <Field label="Body">
          <textarea
            className="textarea"
            rows={10}
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Dear {{customer}},&#10;&#10;Your invoice {{number}} for {{amount}} is due.&#10;&#10;Thank you,&#10;{{company}}"
          />
        </Field>
        <div className="text-xs text-brand-400 bg-brand-50 rounded-xl p-3">
          <p className="font-medium mb-1">Available placeholders:</p>
          <code className="text-[11px]">{`{{customer}} {{company}} {{number}} {{amount}} {{date}} {{due_date}} {{items}} {{link}}`}</code>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!valid}
          onClick={() => onSaved(f as EmailTemplate)}
        >
          {edit ? "Update" : "Create Template"}
        </button>
      </div>
    </Modal>
  );
}
