/** Definitions live in workspace settings, with an account- and mode-scoped cache. Values remain on their business records. */
import { tools } from "./api";
import {
  readAgentStorage,
  writeAgentStorage,
  requireAgentStorageScope,
} from "./agentStorage";

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
    | "leads"
    | "contacts";
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
const TYPES = new Set([
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
  "email",
  "phone",
]);
function validDefinition(
  value: unknown,
  module: CustomFieldDef["module"]
): value is CustomFieldDef {
  if (!value || typeof value !== "object") return false;
  const d = value as CustomFieldDef;
  return (
    d.module === module &&
    typeof d.id === "string" &&
    typeof d.label === "string" &&
    d.label.trim().length > 0 &&
    d.label.length <= 100 &&
    typeof d.key === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(d.key) &&
    !["__proto__", "constructor", "prototype"].includes(d.key) &&
    TYPES.has(d.type) &&
    Number.isFinite(d.position) &&
    (d.options == null ||
      (Array.isArray(d.options) &&
        d.options.length <= 100 &&
        d.options.every(
          (option) => typeof option === "string" && option.length <= 500
        ))) &&
    (d.type !== "select" || !!d.options?.length)
  );
}

function storageKey(module: CustomFieldDef["module"]): string {
  return STORAGE_PREFIX + module;
}
function settingsKey(module: CustomFieldDef["module"]): string {
  return SETTINGS_PREFIX + module;
}

/** Load all custom field defs for a module. */
export function listCustomFields(module: CustomFieldDef["module"]): CustomFieldDef[] {
  try {
    const raw = readAgentStorage(storageKey(module));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((d) => validDefinition(d, module)) ? arr : [];
  } catch (e) {
    console.error("Failed to parse custom fields list", e);
    return [];
  }
}

/** Save all custom field defs for a module (replaces). */
export async function saveCustomFields(
  module: CustomFieldDef["module"],
  defs: CustomFieldDef[],
  expectedScope = requireAgentStorageScope()
): Promise<void> {
  requireAgentStorageScope(expectedScope);
  if (defs.length > 100) throw new Error("Use up to 100 custom fields per section.");
  if (defs.some((d) => !validDefinition(d, module)))
    throw new Error("Each custom field needs a label and a valid unique key.");
  if (new Set(defs.map((d) => d.key)).size !== defs.length)
    throw new Error("Custom field keys must be unique.");
  const json = JSON.stringify(defs);
  await tools.setSetting(settingsKey(module), json);
  requireAgentStorageScope(expectedScope);
  // The acknowledged settings row is authoritative; the cache is optional.
  try {
    writeAgentStorage(storageKey(module), json, expectedScope);
  } catch (e) {
    console.warn("Custom fields saved; cache unavailable", e);
  }
}

/** Sync custom field defs from Supabase. Remote wins when present. */
export async function syncCustomFields(
  module: CustomFieldDef["module"]
): Promise<CustomFieldDef[]> {
  const scope = requireAgentStorageScope();
  const settings = await tools.settings();
  requireAgentStorageScope(scope);
  const row = settings.find((s) => s.key === settingsKey(module));
  const remote: CustomFieldDef[] = row?.value ? JSON.parse(row.value) : [];
  if (
    !Array.isArray(remote) ||
    remote.length > 100 ||
    remote.some((d) => !validDefinition(d, module)) ||
    new Set(remote.map((d) => d.key)).size !== remote.length
  )
    throw new Error(
      "Custom field definitions could not be read. Existing data was preserved."
    );
  try {
    writeAgentStorage(storageKey(module), JSON.stringify(remote), scope);
  } catch (e) {
    console.warn("Custom fields loaded; cache unavailable", e);
  }
  return remote;
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
  if (value != null && !["string", "number", "boolean"].includes(typeof value))
    return `${def.label} must be a simple value.`;
  const v = String(value ?? "").trim();
  if (v.length > 500) return `${def.label} is too long.`;
  if (def.required && (!v || (def.type === "checkbox" && !["true", "1"].includes(v))))
    return `${def.label} is required.`;
  if (!v) return null;
  switch (def.type) {
    case "date":
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v
      )
        return `${def.label} must be a valid date.`;
      return null;
    case "checkbox":
      return ["true", "false", "1", "0"].includes(v)
        ? null
        : `${def.label} must be yes or no.`;
    case "number":
      if (!Number.isFinite(Number(v))) return `${def.label} must be a number.`;
      return null;
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return `${def.label} must be a valid email.`;
      return null;
    case "url":
      try {
        const url = new URL(v.includes(":") ? v : `https://${v}`);
        if (!["https:", "http:"].includes(url.protocol))
          return `${def.label} must use http or https.`;
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
      if (!/^[+\d\s()-]{6,}$/.test(v)) return `${def.label} must be a valid phone.`;
      return null;
    default:
      return null;
  }
}
