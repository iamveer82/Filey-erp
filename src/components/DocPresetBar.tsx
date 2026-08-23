import { useEffect, useRef, useState } from "react";
import { Building2, Bookmark, ChevronDown } from "lucide-react";
import CompanyModal from "./CompanyModal";
import { templatesForDocType, type DocType } from "./DocTemplates";
import { loadCustomTemplates } from "./TemplateDesigner";
import {
  loadDocPresets,
  saveDocPreset,
  presetTemplate,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  type DocPresets,
} from "../lib/docPresets";
import { billing, type CompanyProfile } from "../lib/api";
import { useUI } from "../lib/ui";
import { errMsg } from "../lib/format";
import { MenuPopover, MenuItemRow, SelectMenu } from "./ui-menu";

/** The preset row every document section carries above its list: which
 *  template new documents of this type open on, and which company they are
 *  raised under. Both were things you picked again on every single document —
 *  the template from the gallery inside the editor, the company details from a
 *  button that only three of the five sections had. */
export default function DocPresetBar({
  docType,
  company,
  onCompanySaved,
  onPresetChange,
}: {
  /** Omit for sections whose templates aren't in the shared registry (delivery
   *  challans) — they get the company half of the bar and nothing else. */
  docType?: DocType;
  company: CompanyProfile | null;
  onCompanySaved: (c: CompanyProfile) => void;
  /** Fires with the new template id so the page can restate an open form. */
  onPresetChange?: (template: string) => void;
}) {
  const { toast } = useUI();
  const [presets, setPresets] = useState<DocPresets>({});
  const [companyOpen, setCompanyOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const tplBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    loadDocPresets().then(setPresets).catch(() => {});
  }, []);

  const options = docType
    ? [
        ...templatesForDocType(docType),
        ...loadCustomTemplates().map((t) => ({ id: t.id, name: t.name })),
      ]
    : [];
  const current = docType
    ? presetTemplate(
        presets,
        docType,
        company?.default_template,
        options[0]?.id ?? "minimal"
      )
    : "";

  const pick = async (id: string) => {
    if (!docType) return;
    setPresets((p) => ({ ...p, [docType]: id })); // optimistic
    try {
      setPresets(await saveDocPreset(docType, id));
      onPresetChange?.(id);
      toast.success("Preset saved - new documents will use it.");
    } catch (e) {
      toast.error(`Could not save preset: ${errMsg(e)}`);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
        <Bookmark size={14} /> Preset
      </div>

      {docType && (
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          Template
          <button
            type="button"
            ref={tplBtnRef}
            aria-label="Default template"
            aria-expanded={tplOpen}
            onClick={() => setTplOpen((v) => !v)}
            title="Template new documents of this type open on"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors hover:bg-hover"
          >
            <span className="max-w-[200px] truncate">
              {options.find((t) => t.id === current)?.name ?? current}
            </span>
            <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
          </button>
          <MenuPopover
            open={tplOpen}
            onClose={() => setTplOpen(false)}
            anchorRef={tplBtnRef}
            closeOnScroll
            className="w-56"
          >
            {options.map((t) => (
              <MenuItemRow
                key={t.id}
                label={t.name}
                checked={t.id === current}
                onClick={() => {
                  setTplOpen(false);
                  void pick(t.id);
                }}
              />
            ))}
          </MenuPopover>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="max-w-[220px] truncate text-[12.5px] text-muted-foreground">
          {company?.name || "No company set"}
        </span>
        <button className="btn-ghost" onClick={() => setCompanyOpen(true)}>
          <Building2 size={16} /> Company
        </button>
      </div>

      {company && (
        <CompanyModal
          open={companyOpen}
          company={company}
          onClose={() => setCompanyOpen(false)}
          onSaved={(c) => {
            onCompanySaved(c);
            setCompanyOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Every section's preset in one place, for Settings → Company Details. Same
 *  store as the per-section bars, so changing it either way agrees. */
export function DocPresetsPanel() {
  const { toast } = useUI();
  const [presets, setPresets] = useState<DocPresets>({});
  const [company, setCompany] = useState<CompanyProfile | null>(null);

  useEffect(() => {
    loadDocPresets().then(setPresets).catch(() => {});
    billing
      .getCompany()
      .then(setCompany)
      .catch(() => {});
  }, []);

  const custom = loadCustomTemplates().map((t) => ({ id: t.id, name: t.name }));

  const pick = async (docType: DocType, id: string) => {
    setPresets((p) => ({ ...p, [docType]: id }));
    try {
      setPresets(await saveDocPreset(docType, id));
      toast.success("Preset saved.");
    } catch (e) {
      toast.error(`Could not save preset: ${errMsg(e)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {DOC_TYPES.map((docType) => {
        const options = [...templatesForDocType(docType), ...custom];
        return (
          <label key={docType} className="block">
            <span className="label">{DOC_TYPE_LABELS[docType]}</span>
            <SelectMenu
              value={presetTemplate(
                presets,
                docType,
                company?.default_template,
                options[0]?.id ?? "minimal"
              )}
              onChange={(v) => pick(docType, v)}
              options={options.map((t) => ({ value: t.id, label: t.name }))}
            />
          </label>
        );
      })}
    </div>
  );
}

/** The template a new document should start on, for pages that build a blank
 *  form before the bar has mounted. */
export async function startingTemplate(
  docType: DocType,
  companyDefault: string | undefined,
  fallback: string
): Promise<string> {
  return presetTemplate(await loadDocPresets(), docType, companyDefault, fallback);
}
