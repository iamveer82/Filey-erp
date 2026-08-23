import { useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { templateCategories, type DocType } from "./DocTemplates";
import TemplateTilePreview from "./TemplateTilePreview";
import {
  loadCustomTemplates,
  deleteCustomTemplate,
  syncCustomTemplates,
  type CustomTemplate,
} from "./TemplateDesigner";

export interface DocTemplateGalleryProps {
  value: string;
  onChange: (id: string) => void;
  onDesign: () => void;
  /** Filter templates by document type — only relevant templates shown. */
  docType?: DocType;
  viewAll?: boolean;
  onViewAllToggle?: (v: boolean) => void;
  className?: string;
}

export default function DocTemplateGallery({
  value,
  onChange,
  onDesign,
  docType,
  viewAll: viewAllProp,
  onViewAllToggle,
  className,
}: DocTemplateGalleryProps) {
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates);
  const [viewAll, setViewAll] = useState(viewAllProp ?? false);

  useEffect(() => {
    syncCustomTemplates()
      .then(setCustomTemplates)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (viewAllProp !== undefined) setViewAll(viewAllProp);
  }, [viewAllProp]);

  // Build categorized list, filtered by docType when provided.
  const categories = docType
    ? templateCategories(docType)
    : [{ category: "All", templates: [] as { id: string; name: string; category: string; docTypes: DocType[] }[] }];

  // If no docType filter, fall back to flat list from all categories.
  const allCategorized = docType
    ? categories
    : (() => {
        const all = customTemplates.map((t) => ({ id: t.id, name: t.name, category: "Custom", docTypes: [] as DocType[] }));
        // Use templateCategories with a wildcard: just merge all
        const cats = templateCategories("invoice");
        const otherCats = templateCategories("quote")
          .concat(templateCategories("po"))
          .concat(templateCategories("receipt"));
        const seen = new Set<string>();
        const merged: { category: string; templates: { id: string; name: string; category: string; docTypes: DocType[] }[] }[] = [];
        for (const c of [...cats, ...otherCats]) {
          if (seen.has(c.category)) {
            const existing = merged.find((m) => m.category === c.category)!;
            for (const t of c.templates) {
              if (!existing.templates.find((et) => et.id === t.id)) existing.templates.push(t);
            }
          } else {
            seen.add(c.category);
            merged.push({ category: c.category, templates: [...c.templates] });
          }
        }
        if (all.length) merged.push({ category: "Custom", templates: all });
        return merged;
      })();

  // Flatten for the collapsed (non-viewAll) view — first 5 across all categories.
  const flatShown: { id: string; name: string }[] = [];
  for (const cat of allCategorized) {
    for (const t of cat.templates) {
      flatShown.push({ id: t.id, name: t.name });
      if (flatShown.length >= 5) break;
    }
    if (flatShown.length >= 5) break;
  }
  // Add custom templates to flat view
  for (const t of customTemplates) {
    if (!flatShown.find((f) => f.id === t.id)) flatShown.push({ id: t.id, name: t.name });
  }

  const shown = viewAll ? null : flatShown.slice(0, 5);

  const removeTpl = (id: string) => {
    setCustomTemplates(deleteCustomTemplate(id));
    if (value === id) onChange("minimal");
  };

  const setView = (v: boolean) => {
    setViewAll(v);
    onViewAllToggle?.(v);
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-brand-500">Choose a template</p>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => setView(!viewAll)}
          >
            {viewAll ? "Show less" : "View all templates"}
          </button>
          <button
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={onDesign}
          >
            <Plus size={13} /> Create template
          </button>
        </div>
      </div>

      {/* Collapsed: flat row of first 5 */}
      {!viewAll && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {shown!.map((tpl) => (
            <TemplateTile
              key={tpl.id}
              id={tpl.id}
              name={tpl.name}
              active={value === tpl.id}
              customTemplates={customTemplates}
              onClick={() => onChange(tpl.id)}
              onDelete={removeTpl}
            />
          ))}
        </div>
      )}

      {/* Expanded: grouped by category */}
      {viewAll && (
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {allCategorized.map((cat) => (
            <div key={cat.category}>
              <p className="text-[11px] font-semibold text-brand-400 uppercase tracking-wide mb-2">
                {cat.category}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {cat.templates.map((tpl) => (
                  <TemplateTile
                    key={tpl.id}
                    id={tpl.id}
                    name={tpl.name}
                    active={value === tpl.id}
                    customTemplates={customTemplates}
                    onClick={() => onChange(tpl.id)}
                    onDelete={removeTpl}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateTile({
  id,
  name,
  active,
  customTemplates,
  onClick,
  onDelete,
}: {
  id: string;
  name: string;
  active: boolean;
  customTemplates: CustomTemplate[];
  onClick: () => void;
  onDelete: (id: string) => void;
}) {
  const isCustom = id.startsWith("custom-");
  const ct = isCustom ? customTemplates.find((c) => c.id === id) : null;
  const isFile = ct?.type === "file";
  return (
    <button
      onClick={onClick}
      className={`group relative shrink-0 w-32 rounded-xl border-2 p-2 text-left transition-all cursor-pointer ${
        active
          ? "border-primary-400 bg-primary-50"
          : "border-brand-100 bg-white hover:border-primary-300"
      }`}
    >
      {active && (
        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary-400 text-ink grid place-items-center z-10">
          <Check size={11} strokeWidth={3} />
        </span>
      )}
      {isCustom && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Delete template ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
          className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer shadow-sm border border-brand-100"
        >
          <Trash2 size={11} />
        </span>
      )}
      <TemplateTilePreview templateId={id} customTemplates={customTemplates} />
      <p className="text-xs font-medium text-ink mt-2 flex items-center gap-1">
        {name}
        {isFile ? (
          <span className="text-[9px] px-1 py-0.5 rounded-lg bg-amber-100 text-amber-700 font-medium">
            Uploaded
          </span>
        ) : isCustom ? (
          <span className="text-[9px] px-1 py-0.5 rounded-lg bg-primary-100 text-primary-700 font-medium">
            Custom
          </span>
        ) : null}
      </p>
    </button>
  );
}