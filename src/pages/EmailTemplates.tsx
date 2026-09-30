import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { useUI } from "../lib/ui";
import { PageHeader, MetricCard, DataTable, Modal, Field, Badge, ErrorBanner } from "../components/ui";
import { RowActions } from "../components/RowActions";
import { tools, getCacheScope } from "../lib/api";
import { assertWorkspaceCurrent, effectiveDataMode } from "../lib/dataMode";
import { useLiveSync } from "../lib/realtime";
import { SelectMenu } from "../components/ui-menu";
import { nextLocalId } from "../lib/recordId";

const TMPL_KEY = "filey_email_templates";
/** Mirror key in Supabase (app_settings) for cross-device sync. */
// ponytail: one setting holds this small list; use per-template rows with revisions if concurrent editing is needed.
const SETTING_KEY = "email_templates";
const cacheKey = () => {
  try { assertWorkspaceCurrent(); } catch { return null; }
  const scope = getCacheScope();
  return scope ? `${TMPL_KEY}:${encodeURIComponent(`${effectiveDataMode()}:${scope}`)}` : null;
};

function subscribeScope(changed: () => void) {
  window.addEventListener("filey:agent-storage", changed);
  window.addEventListener("filey:workspace-changed", changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener("filey:agent-storage", changed);
    window.removeEventListener("filey:workspace-changed", changed);
    window.removeEventListener("storage", changed);
  };
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  category: string;
  created_at: string;
}

function load(key: string | null): EmailTemplate[] {
  try {
    return key ? parseTemplates(localStorage.getItem(key) || "[]") : [];
  } catch (e) {
    console.warn("Failed to load email templates", e);
    return [];
  }
}
function parseTemplates(value: string): EmailTemplate[] {
  const rows: unknown = JSON.parse(value);
  if (!Array.isArray(rows) || !rows.every(row => row && Number.isSafeInteger(row.id) && row.id > 0
    && [row.name, row.subject, row.body, row.category].every(field => typeof field === "string")))
    throw new Error("Saved templates could not be read. Try again before editing.");
  return rows as EmailTemplate[];
}
async function save(t: EmailTemplate[], key: string | null): Promise<void> {
  if (!key || cacheKey() !== key) throw new Error("Workspace changed. Reopen this section before saving.");
  await tools.setSetting(SETTING_KEY, JSON.stringify(t));
  if (cacheKey() !== key) throw new Error("Workspace changed while saving. Reopen this section to review the result.");
  // app_settings is authoritative; its disposable mirror can be rebuilt.
  try { localStorage.setItem(key, JSON.stringify(t)); }
  catch { /* The durable save succeeded. */ }
}

/** Pull email templates saved on other devices; remote wins when present. */
async function syncEmailTemplates(key: string | null, isCurrent: () => boolean): Promise<EmailTemplate[] | null> {
  if (!key || cacheKey() !== key) return null;
  const settings = await tools.settings();
  if (cacheKey() !== key || !isCurrent()) return null;
  const row = settings.find((s) => s.key === SETTING_KEY);
  if (row?.value) {
    const remote = parseTemplates(row.value);
    // A stale response must not overwrite a newer save's mirror.
    try { localStorage.setItem(key, JSON.stringify(remote)); }
    catch { /* Render the authoritative records even when the cache is full. */ }
    return remote;
  }
  return cacheKey() === key ? load(key) : null;
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
    subject: "Payment Received - Receipt {{number}}",
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

export default function EmailTemplates() {
  const scope = useSyncExternalStore(subscribeScope, cacheKey);
  // An editor from one account or storage mode must never carry into another.
  return <EmailTemplatesWorkspace key={scope || "signed-out"} scope={scope} />;
}

function EmailTemplatesWorkspace({ scope }: { scope: string | null }) {
  const { toast, confirm } = useUI();
  const [templates, setTemplates] = useState<EmailTemplate[]>(() => load(scope));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  const writing = useRef(false);
  const request = useRef(0);
  const latest = useRef({ templates, loading, error });
  latest.current = { templates, loading, error };
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EmailTemplate | null>(null);
  const reload = useCallback(() => {
    if (writing.current || !active.current) return Promise.resolve();
    const version = ++request.current;
    return syncEmailTemplates(scope, () => active.current && version === request.current)
      .then((t) => {
        if (!scope || t === null || !active.current || version !== request.current || cacheKey() !== scope) return;
        setTemplates(t); setError("");
      })
      .catch(() => { if (active.current && version === request.current && cacheKey() === scope) setError("Couldn't load saved templates. Your current records are preserved."); })
      .finally(() => { if (active.current && version === request.current) setLoading(false); });
  }, [scope]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => { active.current = false; };
  }, [reload]);
  useLiveSync(reload);

  const persist = async (next: EmailTemplate[], message: string): Promise<boolean> => {
    if (!active.current || cacheKey() !== scope || writing.current || latest.current.loading || latest.current.error) return false;
    writing.current = true; setSaving(true); ++request.current;
    try {
      await save(next, scope);
      if (!active.current) return false;
      setTemplates(next); toast.success(message); return true;
    } catch (failure) {
      if (active.current && cacheKey() === scope) toast.error(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
    finally { writing.current = false; if (active.current) setSaving(false); }
  };

  const addStarters = () => {
    const seeded: EmailTemplate[] = [];
    DEFAULT_TEMPLATES.forEach(t => seeded.push({
      ...t,
      id: nextLocalId(seeded),
      created_at: new Date().toISOString(),
    }));
    void persist(seeded, "Starter templates added.");
  };

  const del = async (t: EmailTemplate) => {
    const ok = await confirm({
      title: "Delete template",
      message: `Delete "${t.name}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const next = latest.current.templates.filter((x) => x.id !== t.id);
    await persist(next, "Deleted.");
  };

  const duplicate = (t: EmailTemplate) => {
    const copy = {
      ...t,
      id: nextLocalId(templates),
      name: `${t.name} (copy)`,
      created_at: new Date().toISOString(),
    };
    const next = [...templates, copy];
    void persist(next, "Duplicated.");
  };

  const categories = new Set(templates.map((t) => t.category)).size;
  const retry = () => { setLoading(true); void reload(); };

  return (
    <div className="">
      <PageHeader
        title="Email Templates"
        subtitle="Reusable email templates with placeholders"
        action={
          <div className="flex flex-wrap gap-2">
          {!loading && templates.length === 0 && (
            <button className="btn-ghost" disabled={!scope || saving || !!error} onClick={addStarters}>Use starter templates</button>
          )}
          <button
            className="btn-primary"
            disabled={!scope || loading || saving || !!error}
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> New template
          </button>
          </div>
        }
      />
      {error && <div className="mb-4"><ErrorBanner message={error} /><button className="btn-ghost mt-2" disabled={loading || saving} onClick={retry}>Try again</button></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 joined-kpis mb-6">
        <MetricCard
          label="Templates"
          value={String(templates.length)}
          change="Saved email layouts"
          changeTone="up"
        />
        <MetricCard
          label="Categories"
          value={String(categories)}
          change={categories > 0 ? "Grouped by use" : "None yet"}
          changeTone="up"
        />
      </div>
      <DataTable<EmailTemplate>
        pageSize={10}
        rows={templates}
        loading={loading}
        empty={error ? "Saved templates are unavailable. Try again to reload them." : "No templates yet"}
        columns={[
          { summary: true, truncate: true,
            key: "name",
            label: "Template",
            sortValue: (t) => t.name,
            render: (t) => <span className="font-medium text-ink">{t.name}</span>,
          },
          { summary: true,
            key: "cat",
            label: "Category",
            sortValue: (t) => t.category,
            render: (t) => <Badge tone="info">{t.category}</Badge>,
          },
          { truncate: true,
            key: "subj",
            label: "Subject",
            render: (t) => (
              <span className="text-brand-500">
                {t.subject}
              </span>
            ),
          },
          { actions: true,
            key: "act",
            label: "Actions",
            render: (t) => (
              <RowActions
                onEdit={saving || error ? undefined : () => {
                  setEdit(t);
                  setOpen(true);
                }}
                onCopy={saving || error ? undefined : () => duplicate(t)}
                onDelete={saving || error ? undefined : () => void del(t)}
              />
            ),
          },
        ]}
      />
      {open && (
        <TemplateModal
          open={open}
          edit={edit}
          busy={saving}
          error={error}
          loading={loading}
          onRetry={retry}
          onClose={() => { if (!writing.current) setOpen(false); }}
          onSaved={async (t) => {
            const next = edit
              ? templates.map((x) => (x.id === t.id ? t : x))
              : [
                  ...templates,
                  { ...t, id: nextLocalId(templates), created_at: new Date().toISOString() },
                ];
            if (await persist(next, edit ? "Updated." : "Template added.")) setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  open,
  edit,
  busy,
  error,
  loading,
  onRetry,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: EmailTemplate | null;
  busy: boolean;
  error: string;
  loading: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSaved: (t: EmailTemplate) => Promise<void>;
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
      title={edit ? "Edit Template" : "New template"}
      size="lg"
    >
      {error && <div className="mb-4"><ErrorBanner message={error} /><button className="btn-ghost mt-2" disabled={loading || busy} onClick={onRetry}>Try again</button></div>}
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Template Name *">
            <input
              className="input"
              disabled={busy}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Payment Reminder"
            />
          </Field>
          <Field label="Category">
            <SelectMenu
              ariaLabel="Category"
              disabled={busy}
              value={f.category}
              onChange={(category) => setF({ ...f, category })}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
        </div>
        <Field label="Subject *">
          <input
            className="input"
            disabled={busy}
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })}
            placeholder="Invoice {{number}} from {{company}}"
          />
        </Field>
        <Field label="Body">
          <textarea
            className="textarea"
            disabled={busy}
            rows={10}
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Dear {{customer}},&#10;&#10;Your invoice {{number}} for {{amount}} is due.&#10;&#10;Thank you,&#10;{{company}}"
          />
        </Field>
        <div className="text-xs text-brand-400 bg-brand-50 rounded-xl p-3">
          <p className="font-medium mb-1">Available placeholders:</p>
          <code className="text-xs break-words">{`{{customer}} {{company}} {{number}} {{amount}} {{date}} {{due_date}} {{items}} {{link}}`}</code>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 mt-5 border-t border-border pt-4">
        <button className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!valid || busy || loading || !!error}
          onClick={() => void onSaved(f as EmailTemplate)}
        >
          {busy ? "Saving…" : edit ? "Save changes" : "Create template"}
        </button>
      </div>
    </Modal>
  );
}
