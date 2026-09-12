/* ── CustomFieldsManager (Odoo Studio-style) ──────────────────────
 * Sheet-based editor for adding/removing/reordering user-defined
 * fields on a given module. Use from any page that wants to let
 * the user extend the schema. The values themselves live on each
 * row's `custom_fields` JSONB / object; this component only
 * manages the definitions. */
import { useEffect, useState, useRef } from "react";
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
import { Field, ErrorBanner } from "./ui";
import { useUI } from "../lib/ui";
import { cn, errMsg } from "../lib/format";
import {
  agentStorageScope,
  requireAgentStorageScope,
  AGENT_STORAGE_EVENT,
} from "../lib/agentStorage";
import {
  syncCustomFields,
  saveCustomFields,
  validateCustomValue,
} from "../lib/customFields";
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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scope = useRef<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    scope.current = agentStorageScope();
    setDefs([]);
    setLoading(true);
    setLoaded(false);
    setError("");
    void syncCustomFields(module)
      .then((value) => {
        if (active) {
          setDefs(value);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(errMsg(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const changed = () => {
      if (agentStorageScope() !== scope.current) {
        active = false;
        setDefs([]);
        setLoading(true);
        setLoaded(false);
        setError("Workspace changed. Close and reopen custom fields.");
      }
    };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    window.addEventListener("filey:workspace-changed", changed);
    return () => {
      active = false;
      window.removeEventListener(AGENT_STORAGE_EVENT, changed);
      window.removeEventListener("filey:workspace-changed", changed);
    };
  }, [open, module, attempt]);

  const save = async () => {
    if (inFlight.current || loading || !loaded) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      requireAgentStorageScope(scope.current ?? "signed-out");
      await saveCustomFields(
        module,
        defs.map((d, position) => ({ ...d, position })),
        scope.current ?? "signed-out"
      );
      toast.success("Custom fields saved.");
      onOpenChange(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const add = () => {
    if (!newLabel.trim()) {
      toast.error("Label is required.");
      return;
    }
    const base = newLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32);
    let key = /^[a-z]/.test(base) ? base : `field_${base || "value"}`;
    if (["constructor", "prototype", "__proto__"].includes(key)) key = `field_${key}`;
    const original = key;
    for (let n = 2; defs.some((d) => d.key === key); n++) key = `${original}_${n}`;
    const def: CustomFieldDef = {
      id: crypto.randomUUID(),
      module,
      key,
      position: defs.length,
      createdAt: new Date().toISOString(),
      label: newLabel.trim(),
      type: newType,
      options:
        newType === "select"
          ? newOptions
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    };
    setDefs((d) => [...d, def]);
    setNewLabel("");
    setNewOptions("");
    setNewType("text");
  };

  const remove = async (def: CustomFieldDef) => {
    const ok = await confirm({
      title: "Remove field",
      message: `Delete "${def.label}"? Existing values for this field will be hidden (not deleted).`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDefs((d) => d.filter((f) => f.id !== def.id));
  };

  const move = async (id: string, dir: -1 | 1) => {
    const sorted = [...defs].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const tmp = sorted[i];
    sorted[i] = sorted[j];
    sorted[j] = tmp;
    setDefs(sorted.map((f, k) => ({ ...f, position: k })));
  };

  const update = async (id: string, patch: Partial<CustomFieldDef>) => {
    setDefs((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!inFlight.current) onOpenChange(value);
      }}
    >
      <SheetContent side="right" className="flex flex-col w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Custom fields</SheetTitle>
          <SheetDescription>
            Choose the extra information to capture in this section. Changes apply
            when you save. Removing a field hides its existing values.
          </SheetDescription>
        </SheetHeader>

        {error && <ErrorBanner message={error} />}
        {loading && !error && <p role="status">Loading fields…</p>}
        {error && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Reload fields
          </button>
        )}
        <fieldset
          disabled={busy || loading || !loaded}
          className="mt-4 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1"
        >
          {defs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-brand-200 p-6 text-center text-sm text-brand-400">
              No custom fields yet. Add a field for details that matter to your business.
            </div>
          ) : (
            defs
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((def) => {
                const Icon = TYPE_ICONS[def.type];
                const sample = sampleValues?.[def.key] ?? "";
                const vErr = sample ? validateCustomValue(def, sample) : null;
                return (
                  <div key={def.id} className="rounded-xl border border-brand-200 p-3">
                    <div className="flex items-start gap-2">
                      <GripVertical
                        size={14}
                        className="mt-0.5 text-brand-400 shrink-0"
                      />
                      <div className="grid h-7 w-7 place-items-center rounded-xl bg-brand-100 text-ink dark:bg-white/12">
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
                                : "border-brand-200 bg-brand-50/50 text-brand-500 dark:bg-white/8"
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
                          className="rounded-xl p-1 text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
                          onClick={() => move(def.id, -1)}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          aria-label="Move down"
                          className="rounded-xl p-1 text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
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
        </fieldset>

        {/* Add new */}
        <fieldset
          disabled={busy || loading || !loaded}
          className="mt-3 border-t border-border pt-3 space-y-2"
        >
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
          <Button
            onClick={add}
            variant="outline"
            disabled={!newLabel.trim() || defs.length >= 100}
            className="w-full"
          >
            <Plus size={14} /> Add field
          </Button>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || loading || !loaded}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save fields"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
