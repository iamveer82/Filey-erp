import { useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { DOC_TEMPLATES } from "./DocTemplates";
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
  viewAll?: boolean;
  onViewAllToggle?: (v: boolean) => void;
  className?: string;
}

export default function DocTemplateGallery({
  value,
  onChange,
  onDesign,
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

  const allTemplates = [
    ...DOC_TEMPLATES,
    ...customTemplates.map((t) => ({ id: t.id, name: t.name })),
  ];
  const shown = viewAll ? allTemplates : allTemplates.slice(0, 5);

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
            <Plus size={13} /> Create Template
          </button>
        </div>
      </div>
      <div
        className={
          viewAll
            ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
            : "flex gap-3 overflow-x-auto pb-1"
        }
      >
        {shown.map((tpl) => {
          const active = value === tpl.id;
          const isCustom = tpl.id.startsWith("custom-");
          const ct = isCustom ? customTemplates.find((c) => c.id === tpl.id) : null;
          const isFile = ct?.type === "file";
          return (
            <button
              key={tpl.id}
              onClick={() => onChange(tpl.id)}
              className={`group relative shrink-0 w-32 rounded-2xl border-2 p-2 text-left transition-all cursor-pointer ${
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
                  aria-label={`Delete template ${tpl.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTpl(tpl.id);
                  }}
                  className="absolute top-1.5 left-1.5 z-20 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 cursor-pointer shadow-sm border border-brand-100"
                >
                  <Trash2 size={11} />
                </span>
              )}
              <TemplateTilePreview templateId={tpl.id} customTemplates={customTemplates} />
              <p className="text-xs font-medium text-ink mt-2 flex items-center gap-1">
                {tpl.name}
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
        })}
      </div>
    </div>
  );
}
