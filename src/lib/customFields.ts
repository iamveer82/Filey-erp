/* ── Custom field registry (Odoo Studio pattern) ──────────────────
 * Each module can have its own set of user-defined fields. The
 * registry lives in localStorage (and `app_settings` for cross-device
 * sync) so the user can add/remove fields without DB migrations.
 *
 * Storage keys:
 * - `filey.custom_fields.<module>` — JSON: CustomFieldDef[]
 * - `app_settings.custom_fields_<module>` — same shape, synced
 *
 * CustomFieldDef shape:
 * { id, module, key, label, type, options?, required?, position }
 *
 * Custom field values are stored in a `custom_fields` JSONB column
 * on each row, OR (for non-supabase rows) in localStorage. The
 * `applyCustomFields` helper writes a value into a row, the
 * `readCustomFields` helper reads them back. */
import { tools } from "./api";

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "url"
  | "email"
  | "phone";

export interface CustomFieldDef {
  id: string;
  module:
    | "customers"
    | "suppliers"
    | "products"
    | "invoices"
    | "orders"
    | "purchase_orders"
    | "employees"
    | "leads";
  key: string;
  label: string;
  type: CustomFieldType;
  /** For "select" type. */
  options?: string[];
  required?: boolean;
  position: number;
  createdAt: string;
}

const STORAGE_PREFIX = "filey.custom_fields.";
const SETTINGS_PREFIX = "custom_fields_";

function storageKey(module: CustomFieldDef["module"]): string {
  return STORAGE_PREFIX + module;
}
function settingsKey(module: CustomFieldDef["module"]): string {
  return SETTINGS_PREFIX + module;
}

/** Load all custom field defs for a module. */
export function listCustomFields(module: CustomFieldDef["module"]): CustomFieldDef[] {
  try {
    const raw = localStorage.getItem(storageKey(module));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("Failed to parse custom fields list", e);
    return [];
  }
}

/** Save all custom field defs for a module (replaces). */
export function saveCustomFields(
  module: CustomFieldDef["module"],
  defs: CustomFieldDef[]
): void {
  try {
    localStorage.setItem(storageKey(module), JSON.stringify(defs));
    void tools.setSetting(settingsKey(module), JSON.stringify(defs)).catch(() => {});
  } catch (e) {
    console.warn("Failed to save custom fields", e);
    /* storage full / unavailable */
  }
}

/** Sync custom field defs from Supabase. Remote wins when present. */
export async function syncCustomFields(
  module: CustomFieldDef["module"]
): Promise<CustomFieldDef[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === settingsKey(module));
    if (row?.value) {
      const remote: CustomFieldDef[] = JSON.parse(row.value);
      try {
        localStorage.setItem(storageKey(module), JSON.stringify(remote));
      } catch (e) {
        console.warn("Failed to cache remote custom fields", e);
        /* ignore */
      }
      return remote;
    }
  } catch (e) {
    console.warn("Failed to sync custom fields from server", e);
    /* offline */
  }
  return listCustomFields(module);
}

/** Add a new field. Generates a stable `key` slug from the label. */
export function addCustomField(
  module: CustomFieldDef["module"],
  input: Omit<CustomFieldDef, "id" | "key" | "module" | "position" | "createdAt"> & {
    key?: string;
  }
): CustomFieldDef {
  const existing = listCustomFields(module);
  const key =
    input.key ||
    input.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) ||
    `field_${Date.now()}`;
  // Ensure key is unique
  let finalKey = key;
  let n = 1;
  while (existing.some((f) => f.key === finalKey)) {
    finalKey = `${key}_${n++}`;
  }
  const def: CustomFieldDef = {
    id: `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    module,
    key: finalKey,
    label: input.label,
    type: input.type,
    options: input.options,
    required: input.required,
    position: existing.length,
    createdAt: new Date().toISOString(),
  };
  const next = [...existing, def];
  saveCustomFields(module, next);
  return def;
}

/** Update an existing field by id. */
export function updateCustomField(
  module: CustomFieldDef["module"],
  id: string,
  patch: Partial<Omit<CustomFieldDef, "id" | "module" | "createdAt">>
): void {
  const existing = listCustomFields(module);
  const next = existing.map((f) => (f.id === id ? { ...f, ...patch } : f));
  saveCustomFields(module, next);
}

/** Remove a field by id. */
export function removeCustomField(module: CustomFieldDef["module"], id: string): void {
  const existing = listCustomFields(module);
  saveCustomFields(
    module,
    existing.filter((f) => f.id !== id)
  );
}

/** Reorder fields by array of ids. */
export function reorderCustomFields(
  module: CustomFieldDef["module"],
  idsInOrder: string[]
): void {
  const existing = listCustomFields(module);
  const byId = new Map(existing.map((f) => [f.id, f]));
  const next = idsInOrder
    .map((id, i) => {
      const f = byId.get(id);
      return f ? { ...f, position: i } : null;
    })
    .filter((f): f is CustomFieldDef => f !== null);
  saveCustomFields(module, next);
}

/** Render a field def as an HTML input attribute hint. */
export function inputTypeFor(type: CustomFieldType): string {
  switch (type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "checkbox":
      return "checkbox";
    case "url":
      return "url";
    case "email":
      return "email";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

/** Validate a value against a field def. Returns null on success,
 * or an error message. */
export function validateCustomValue(def: CustomFieldDef, value: unknown): string | null {
  const v = String(value ?? "").trim();
  if (def.required && !v) return `${def.label} is required.`;
  if (!v) return null;
  switch (def.type) {
    case "number":
      if (isNaN(Number(v))) return `${def.label} must be a number.`;
      return null;
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return `${def.label} must be a valid email.`;
      return null;
    case "url":
      try {
        new URL(v.startsWith("http") ? v : `https://${v}`);
      } catch (e) {
        console.warn("Invalid custom field URL", e);
        return `${def.label} must be a valid URL.`;
      }
      return null;
    case "select":
      if (def.options && !def.options.includes(v))
        return `${def.label} must be one of the options.`;
      return null;
    case "phone":
      if (!/^[+\d\s\-\(\)]{6,}$/.test(v)) return `${def.label} must be a valid phone.`;
      return null;
    default:
      return null;
  }
}
