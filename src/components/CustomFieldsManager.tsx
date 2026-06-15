/* ── CustomFieldsManager (Odoo Studio-style) ──────────────────────
 * Sheet-based editor for adding/removing/reordering user-defined
 * fields on a given module. Use from any page that wants to let
 * the user extend the schema. The values themselves live on each
 * row's `custom_fields` JSONB / object; this component only
 * manages the definitions. */
import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  Type,
  Hash,
  Calendar,
  ListChecks,
  Link2,
  Mail,
  Phone,
  Square,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./Sheet";
import { Button } from "./Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Field } from "./ui";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";
import type { CustomFieldDef, CustomFieldType } from "../lib/customFields";

const TYPE_ICONS: Record<CustomFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  date: Calendar,
  select: ListChecks,
  checkbox: Square,
  url: Link2,
  email: Mail,
  phone: Phone,
};

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Select",
  checkbox: "Yes/No",
  url: "URL",
  email: "Email",
  phone: "Phone",
};

export interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: CustomFieldDef["module"];
  /** Optional: sample values for the preview row (so the user
   * can see how a field will look once filled in). */
  sampleValues?: Record<string, string>;
}

export function CustomFieldsManager({
  open,
  onOpenChange,
  module,
  sampleValues,
}: CustomFieldsManagerProps) {
  const { toast, confirm } = useUI();
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");
  const [newOptions, setNewOptions] = useState("");

  const sync = useCallback(
    () =>
      import("../lib/customFields").then((m) =>
        m.syncCustomFields(module).then(setDefs)
      ),
    [module]
  );

  useEffect(() => {
    if (open) sync();
  }, [open, sync]);

  const add = () => {
    if (!newLabel.trim()) {
      toast.error("Label is required.");
      return;
    }
    import("../lib/customFields").then((m) => {
      const def = m.addCustomField(module, {
        label: newLabel.trim(),
        type: newType,
        options:
          newType === "select"
            ? newOptions
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
      });
      setDefs((d) => [...d, def]);
      setNewLabel("");
      setNewOptions("");
      setNewType("text");
      toast.success(`Added "${def.label}".`);
    });
  };

  const remove = async (def: CustomFieldDef) => {
    const ok = await confirm({
      title: "Remove field",
      message: `Delete "${def.label}"? Existing values for this field will be hidden (not deleted).`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const m = await import("../lib/customFields");
    m.removeCustomField(module, def.id);
    setDefs((d) => d.filter((f) => f.id !== def.id));
    toast.success("Removed.");
  };

  const move = async (id: string, dir: -1 | 1) => {
    const sorted = [...defs].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const tmp = sorted[i];
    sorted[i] = sorted[j];
    sorted[j] = tmp;
    const m = await import("../lib/customFields");
    m.reorderCustomFields(
      module,
      sorted.map((f) => f.id)
    );
    setDefs(sorted.map((f, k) => ({ ...f, position: k })));
  };

  const update = async (id: string, patch: Partial<CustomFieldDef>) => {
    const m = await import("../lib/customFields");
    m.updateCustomField(module, id, patch);
    setDefs((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Custom fields</SheetTitle>
          <SheetDescription>
            Add user-defined fields to <b>{module}</b> records. Stored per row, synced
            across devices. Like Odoo Studio.
          </SheetDescription>
        </SheetHeader>

        {/* List */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          {defs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-brand-200 p-6 text-center text-sm text-brand-400 dark:border-[#2C2C2E]">
              No custom fields yet. Add one below to extend the schema.
            </div>
          ) : (
            defs
              .slice()
              .sort((a, b) => a.position - b.position)
              .map(async (def) => {
                const Icon = TYPE_ICONS[def.type];
                const sample = sampleValues?.[def.key] ?? "";
                const mod = await import("../lib/customFields");
                const vErr = sample ? mod.validateCustomValue(def, sample) : null;
                return (
                  <div
                    key={def.id}
                    className="rounded-3xl border border-brand-200 p-3 dark:border-[#2C2C2E]"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical
                        size={14}
                        className="mt-0.5 text-brand-400 shrink-0"
                      />
                      <div className="grid h-7 w-7 place-items-center rounded-3xl bg-brand-100 text-ink dark:bg-white/12">
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <input
                          className="input"
                          value={def.label}
                          onChange={(e) => update(def.id, { label: e.target.value })}
                          placeholder="Field label"
                        />
                        <div className="flex items-center gap-2 text-[11px] text-brand-400 font-mono">
                          <span>{def.key}</span>
                          <span>·</span>
                          <span>{TYPE_LABELS[def.type]}</span>
                          {def.required && (
                            <>
                              <span>·</span>
                              <span className="text-danger">required</span>
                            </>
                          )}
                        </div>
                        {def.type === "select" && def.options && (
                          <input
                            className="input text-xs"
                            value={def.options.join(", ")}
                            onChange={(e) =>
                              update(def.id, {
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="Option 1, Option 2, …"
                          />
                        )}
                        {sample && (
                          <div
                            className={cn(
                              "rounded-lg border border-dashed p-2 text-xs",
                              vErr
                                ? "border-danger/40 bg-danger/5 text-danger"
                                : "border-brand-200 bg-brand-50/50 text-brand-500 dark:border-[#2C2C2E] dark:bg-white/8"
                            )}
                          >
                            <span className="font-medium text-ink">Preview: </span>
                            {sample}
                            {vErr && <span className="block mt-1">⚠ {vErr}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <button
                          aria-label="Move up"
                          className="rounded-3xl p-1 text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
                          onClick={() => move(def.id, -1)}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          aria-label="Move down"
                          className="rounded-3xl p-1 text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
                          onClick={() => move(def.id, 1)}
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          aria-label="Delete field"
                          className="rounded-full p-1 text-danger hover:bg-danger/10 cursor-pointer"
                          onClick={() => void remove(def)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer text-brand-500">
                        <input
                          type="checkbox"
                          checked={!!def.required}
                          onChange={(e) => update(def.id, { required: e.target.checked })}
                          className="cursor-pointer"
                        />
                        Required
                      </label>
                    </div>
                  </div>
                );
              })
          )}
        </div>

        {/* Add new */}
        <div className="mt-3 border-t border-brand-200 dark:border-[#2C2C2E] pt-3 space-y-2">
          <p className="text-[10px] font-medium tracking-[0.06em] text-brand-400">
            Add new field
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Label">
              <input
                className="input"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Customer rating"
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
              />
            </Field>
            <Field label="Type">
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as CustomFieldType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {newType === "select" && (
            <Field label="Options (comma-separated)">
              <input
                className="input"
                value={newOptions}
                onChange={(e) => setNewOptions(e.target.value)}
                placeholder="Hot, Warm, Cold"
              />
            </Field>
          )}
          <Button onClick={add} className="w-full">
            <Plus size={14} /> Add field
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── CustomFieldValue (read-only display chip) ──────────────────── */
export function CustomFieldValue({
  def,
  value,
}: {
  def: CustomFieldDef;
  value: unknown;
}) {
  const v = String(value ?? "").trim();
  if (!v && def.type !== "checkbox") return null;
  if (def.type === "checkbox") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            v === "true" || v === "1" ? "bg-success" : "bg-brand-200 dark:bg-white/12"
          )}
        />
        <span className="text-brand-500 font-medium">{def.label}</span>
      </span>
    );
  }
  return (
    <div className="text-xs">
      <span className="text-brand-400 font-medium">{def.label}:</span>{" "}
      <span className="text-ink">{v}</span>
    </div>
  );
}
