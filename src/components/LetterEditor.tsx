import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  Save,
  Settings2,
} from "lucide-react";
import type { LetterForm } from "../lib/letters";
import {
  letterRichDocumentToLegacy,
  type LetterRichDocument,
} from "../lib/letterRichText";
import { Field, Switch } from "./ui";
import { DateField } from "./DatePicker";
import { SelectMenu } from "./ui-menu";
import { LETTER_TEMPLATES } from "./LetterDocument";
import { LetterWordEditor } from "./LetterWordEditor";

export function LetterEditor({
  form,
  setForm,
  busy,
  lookupError,
  onRetry,
  onBack,
  onSave,
  onIssue,
  onPreview,
  onDownload,
  onDuplicate,
}: {
  form: LetterForm;
  setForm: (form: LetterForm) => void;
  busy: boolean;
  lookupError: string;
  onRetry: () => void;
  onBack: () => void;
  onSave: () => void;
  onIssue: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onDuplicate?: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const issued = form.status === "issued",
    disabled = busy || issued;
  const set = <K extends keyof LetterForm>(key: K, value: LetterForm[K]) =>
    setForm({ ...form, [key]: value });
  const edit = (document: LetterRichDocument) =>
    setForm({
      ...form,
      rich_document: document,
      ...letterRichDocumentToLegacy(document),
    });
  const input = (
    key: "number" | "company_name" | "company_email" | "company_phone" | "company_trn",
    label: string,
    maxLength = 160
  ) => (
    <Field label={label}>
      <input
        className="input w-full"
        value={form[key]}
        maxLength={maxLength}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-64">
          <button
            type="button"
            className="btn-ghost shrink-0"
            disabled={busy}
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="letter-document-title">
              Letter title
            </label>
            <input
              id="letter-document-title"
              aria-label="Letter title"
              placeholder="Untitled letter"
              className="w-full max-w-md truncate rounded-md border border-transparent bg-transparent px-1 py-1 text-lg font-semibold outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
              maxLength={200}
              value={form.title}
              disabled={disabled}
              onChange={(event) => set("title", event.target.value)}
            />
            <p className="whitespace-nowrap px-1 text-xs text-muted-foreground">
              {form.number} · {issued ? "Issued" : "Draft"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onPreview}>
            <Eye size={15} /> Preview
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onDownload}
          >
            <Download size={15} /> PDF
          </button>
          {issued ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !onDuplicate}
              onClick={onDuplicate}
            >
              <Copy size={15} /> Duplicate draft
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={onSave}
              >
                <Save size={15} /> Save draft
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={onIssue}
              >
                <Check size={15} /> {busy ? "Working…" : "Issue letter"}
              </button>
            </>
          )}
        </div>
      </div>
      {issued && (
        <p role="status" className="text-sm text-muted-foreground">
          This issued copy keeps its saved content and company details. Duplicate it to
          make changes.
        </p>
      )}
      {lookupError && !issued && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {lookupError}
          <button type="button" className="btn-ghost" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-4 text-left text-sm hover:bg-muted/50"
          aria-expanded={settings}
          aria-controls="letter-page-settings"
          onClick={() => setSettings(!settings)}
        >
          <Settings2 size={15} />
          <span>Page & company settings</span>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
            {LETTER_TEMPLATES.find((template) => template.id === form.template)?.label ||
              "Company letter"}{" "}
            · A4
          </span>
          <ChevronDown size={15} className={settings ? "rotate-180" : ""} />
        </button>
        {settings && (
          <fieldset
            id="letter-page-settings"
            disabled={disabled}
            className="space-y-5 border-t border-border p-4 sm:p-5"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {input("number", "Internal letter number", 100)}
              <Field label="Issue date" required>
                <DateField
                  value={form.issue_date}
                  onChange={(value) => set("issue_date", value)}
                />
              </Field>
              <Field label="Letter layout">
                <SelectMenu
                  ariaLabel="Letter layout"
                  value={form.template}
                  disabled={disabled}
                  options={LETTER_TEMPLATES.map((template) => ({
                    value: template.id,
                    label: template.label,
                  }))}
                  onChange={(value) => set("template", value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["show_company_header", "Show company details", false],
                  [
                    "use_letterhead",
                    "Use company letterhead",
                    !form.letterhead?.background,
                  ],
                  ["show_logo", "Show company logo", !form.company_logo],
                  ["show_reference", "Show letter reference", false],
                  ["show_signature", "Use saved signature", !form.signature?.data],
                  ["show_stamp", "Use saved company stamp", !form.stamp?.data],
                ] as const
              ).map(([key, label, unavailable]) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm">{label}</p>
                    {unavailable && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Add this image in Company Details.
                      </p>
                    )}
                    {key === "show_reference" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Optional. Its number stays on your dashboard.
                      </p>
                    )}
                  </div>
                  <Switch
                    label={label}
                    disabled={disabled || (unavailable && !form[key])}
                    checked={
                      key === "show_company_header"
                        ? (form[key] ??
                          !(form.use_letterhead && form.letterhead?.background))
                        : key === "show_reference"
                          ? form[key] !== false
                          : !!form[key]
                    }
                    onChange={(value) => set(key, value)}
                  />
                </div>
              ))}
            </div>
            <details className="border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Company details on this letter
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {input("company_name", "Company name")}
                {input("company_email", "Email", 254)}
                {input("company_phone", "Phone", 40)}
                {input("company_trn", "Tax registration number", 60)}
                <div className="sm:col-span-2">
                  <Field label="Company address">
                    <textarea
                      className="input min-h-20 w-full resize-y"
                      maxLength={400}
                      value={form.company_address}
                      onChange={(event) => set("company_address", event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </details>
            <p className="text-xs text-muted-foreground">
              Type recipient details, the subject, your letter and sign-off directly on
              the page. Company images come from Settings → Company Details.
            </p>
          </fieldset>
        )}
      </div>
      <LetterWordEditor form={form} disabled={disabled} onChange={edit} />
    </div>
  );
}
