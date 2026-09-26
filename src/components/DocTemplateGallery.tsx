import { useEffect, useState } from "react";
import { Plus, Trash2, Check, Maximize2 } from "lucide-react";
import { DOC_TEMPLATES, resolveTemplateId, type DocType } from "./DocTemplates";
import TemplateTilePreview from "./TemplateTilePreview";
import { Modal, FilterChip, SearchInput } from "./ui";
import { useUI } from "../lib/ui";
import { cn, errMsg } from "../lib/format";
import { type CustomTemplate } from "./TemplateDesigner";
import { adoptLegacyCustomTemplates, deleteCustomTemplate, hasUnscopedCustomTemplates, useCustomTemplates } from "../lib/customTemplates";

export interface DocTemplateGalleryProps {
  value: string;
  onChange: (id: string) => void;
  onDesign: () => void;
  docType?: DocType;
  viewAll?: boolean;
  onViewAllToggle?: (v: boolean) => void;
  className?: string;
  hideHeader?: boolean;
}

type TemplateOption = { id: string; name: string; category: string; custom?: CustomTemplate };
const DOCUMENT_NAMES: Record<DocType, string> = {
  invoice: "invoices", quote: "quotations", po: "purchase orders", receipt: "payment receipts",
};
// Size columns from the picker itself, including when it sits in a split panel.
const gridColumns = { gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 160px), 1fr))" };

export default function DocTemplateGallery({
  value, onChange, onDesign, docType, viewAll: viewAllProp, onViewAllToggle, className, hideHeader = false,
}: DocTemplateGalleryProps) {
  const { confirm, toast } = useUI();
  const { templates: customTemplates, loading, error: loadError, reload } = useCustomTemplates();
  const [viewAll, setViewAll] = useState(viewAllProp ?? false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => { if (viewAllProp !== undefined) setViewAll(viewAllProp); }, [viewAllProp]);

  const options: TemplateOption[] = [
    ...DOC_TEMPLATES.filter((template) => !docType || template.docTypes.includes(docType)),
    ...customTemplates.map((custom) => ({ id: custom.id, name: custom.name, category: "My templates", custom })),
  ];
  // Keep older documents' selected layouts visible without changing them.
  if (value && !options.some((template) => template.id === value)) {
    const legacy = DOC_TEMPLATES.find((template) => template.id === resolveTemplateId(value));
    options.unshift({ id: value, name: value.startsWith("custom-") ? "Saved custom template" : legacy?.name || "Saved template", category: "Current template" });
  }
  const selected = options.find((template) => template.id === value);
  const categories = ["All", ...new Set(options.map((template) => template.category))];
  const query = search.trim().toLowerCase();
  const filtered = options.filter((template) => (category === "All" || template.category === category) && (template.name + " " + template.category).toLowerCase().includes(query));
  const preview = options.find((template) => template.id === previewId);

  const setView = (open: boolean) => { setViewAll(open); onViewAllToggle?.(open); };
  const choose = (id: string) => { onChange(id); setPreviewId(null); setView(false); };
  const design = () => { setView(false); onDesign(); };
  const remove = async (template: TemplateOption) => {
    if (!(await confirm({ title: "Delete template", message: 'Delete custom template "' + template.name + '"? This cannot be undone.', confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteCustomTemplate(template.id);
      if (value === template.id) onChange(DOC_TEMPLATES.find((item) => !docType || item.docTypes.includes(docType))!.id);
      if (previewId === template.id) setPreviewId(null);
      toast.success("Template deleted.");
    } catch (error) { toast.error("Could not delete template: " + errMsg(error)); }
  };
  const tile = (template: TemplateOption) => (
    <TemplateTile key={template.id} template={template} active={value === template.id} customTemplates={customTemplates} docType={docType}
      onChoose={() => choose(template.id)} onPreview={() => setPreviewId(template.id)} onDelete={() => { void remove(template); }} />
  );

  return (
    <div className={cn("min-w-0", className)}>
      {!hideHeader && <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Choose a template</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => setView(true)}>Browse templates</button>
          <button type="button" className="btn-ghost" onClick={design}><Plus size={15} /> Create template</button>
        </div>
      </div>}
      {loading && <p role="status" className="mb-3 text-xs text-muted-foreground">Loading this workspace’s saved templates…</p>}
      {loadError && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-danger"><span>Could not load saved templates: {loadError}</span><button type="button" className="btn-ghost" onClick={reload}>Retry</button></div>}
      {!loading && !loadError && !customTemplates.length && hasUnscopedCustomTemplates() && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-hover px-3 py-2 text-xs text-muted-foreground">
          <span>Templates you saved on this device before accounts were added are still here.</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void adoptLegacyCustomTemplates()
                .then((adopted) => { if (adopted.length) toast.success(`Restored ${adopted.length} template${adopted.length === 1 ? "" : "s"}.`); })
                .catch((error) => toast.error("Could not restore them: " + errMsg(error)));
            }}
          >
            Restore my templates
          </button>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-4" aria-label="Selected document template">
        {selected && <div className="w-14 shrink-0 overflow-hidden rounded-md border border-border" aria-hidden="true"><TemplateTilePreview templateId={selected.id} customTemplates={customTemplates} docType={docType} /></div>}
        <div className="min-w-0 flex-1"><p className="text-sm font-medium break-words">{selected?.name || "Choose your document layout"}</p><p className="mt-1 text-xs text-muted-foreground">{selected ? "Selected layout" : "No layout selected"} · {options.length} templates available</p></div>
        <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={selected ? "Preview " + selected.name + " template" : "Browse templates"} onClick={() => selected ? setPreviewId(selected.id) : setView(true)}><Maximize2 size={15} /></button>
      </div>

      <Modal open={viewAll} onClose={() => setView(false)} title="Choose a template" size="3xl">
        <div className="mb-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-lg text-sm text-muted-foreground">{docType ? "Layouts for " + DOCUMENT_NAMES[docType] + "." : "Document layouts."} Preview a design, then choose it for your document.</p>
            <button type="button" className="btn-ghost shrink-0" onClick={design}><Plus size={15} /> Create template</button>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" className="w-full" />
          <div className="flex flex-wrap gap-2" aria-label="Template categories">
            {categories.map((name) => <FilterChip key={name} active={category === name} onClick={() => setCategory(name)}>{name}</FilterChip>)}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{filtered.length} {filtered.length === 1 ? "template" : "templates"}{selected ? " · Selected: " + selected.name : ""}</p>
        </div>
        {filtered.length ? <div className="grid min-w-0 gap-4" style={gridColumns}>{filtered.map(tile)}</div> : (
          <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
            <p className="font-medium text-foreground">No matching templates</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different name or category.</p>
            <button type="button" className="btn-ghost mt-4" onClick={() => { setSearch(""); setCategory("All"); }}>Clear filters</button>
          </div>
        )}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreviewId(null)} title={preview?.name || "Template preview"} size="3xl">
        {preview && <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Example content · Your document details stay unchanged.</p>
            <button type="button" className="btn-primary" onClick={() => choose(preview.id)}><Check size={15} /> Use this template</button>
          </div>
          <div className="mx-auto max-w-[720px] rounded-xl bg-muted p-3 sm:p-6">
            <TemplateTilePreview templateId={preview.id} customTemplates={customTemplates} docType={docType} />
          </div>
        </>}
      </Modal>
    </div>
  );
}

function TemplateTile({ template, active, customTemplates, docType, onChoose, onPreview, onDelete }: {
  template: TemplateOption; active: boolean; customTemplates: CustomTemplate[]; docType?: DocType;
  onChoose: () => void; onPreview: () => void; onDelete: () => void;
}) {
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-xl border bg-card transition-colors", active ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-muted-foreground/50")}>
      <button type="button" aria-label={"Use " + template.name + " template"} aria-pressed={active} onClick={onChoose}
        className="block w-full min-w-0 cursor-pointer p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <TemplateTilePreview templateId={template.id} customTemplates={customTemplates} docType={docType} />
        <span className="mt-3 block min-h-10 break-words text-[13px] font-medium leading-5 text-foreground">{template.name}</span>
      </button>
      {active && <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-foreground text-background"><Check size={13} strokeWidth={2.5} /></span>}
      <div className="flex min-w-0 items-center justify-between gap-1 border-t border-border px-2.5 py-1.5">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{template.custom?.type === "file" ? "Uploaded" : template.custom ? "Custom" : active ? "Selected" : "Built-in"}</span>
        <div className="flex shrink-0 items-center">
          <button type="button" className="btn-ghost h-10 w-10 p-0" aria-label={"Preview " + template.name + " template"} onClick={onPreview}><Maximize2 size={14} /></button>
          {template.custom && <button type="button" className="btn-ghost h-10 w-10 p-0 hover:text-danger" aria-label={"Delete template " + template.name} onClick={onDelete}><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}
