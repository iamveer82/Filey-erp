import { createElement } from "react";
import { billing, getCacheIdentity, tools } from "./api";
import { agentStorageScope, requireAgentStorageScope } from "./agentStorage";
import { requireModuleAccess } from "./moduleAccess";
import { allocateDocumentNumber } from "./documentNumbers";
import { type DocFormats, formatKey } from "./numberFormat";
import {
  blankLetterForm,
  letterDisplayForm,
  loadLetters,
  saveLetter,
  validateLetterForm,
  validateLetterTextStyle,
  type LetterBlock,
  type LetterForm,
  type LetterRecord,
} from "./letters";
import type { DeliveredFile } from "./agentFiles";

const LAYOUTS = ["letter-standard", "letter-modern", "letter-formal"] as const;
const TEXT_FIELDS = ["title", "issue_date", "recipient_name", "recipient_address", "salutation", "body", "closing", "signatory_name", "signatory_title", "accent"] as const;
const FLAGS = ["use_letterhead", "show_company_header", "show_logo", "show_reference"] as const;
const PATCH_KEYS = [...TEXT_FIELDS, ...FLAGS, "template", "text_style", "title_style", "blocks"];
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const argumentErrors = new WeakSet<object>();
export const isLetterArgumentError = (error: unknown): boolean =>
  !!error && typeof error === "object" && argumentErrors.has(error);
const argumentError = (message: string) => {
  const error = new Error(message);
  argumentErrors.add(error);
  return error;
};
function validateInput(validate: () => void): void {
  try { validate(); } catch (error) {
    if (error && typeof error === "object") argumentErrors.add(error);
    throw error;
  }
}
const alignmentSchema = { type: "string", enum: ["left", "center", "right"] };
const textStyleSchema = {
  type: "object", additionalProperties: false, properties: {
    font: { type: "string", enum: ["modern", "classic", "mono"] }, align: alignmentSchema,
    fontSize: { type: "number", minimum: 8, maximum: 36 }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, lineSpacing: { type: "number", minimum: 1, maximum: 2.5 },
    paragraphSpacing: { type: "number", minimum: 0, maximum: 32 },
  },
};

/** Shared tool schema; status, internal IDs and private image URLs are never model-editable. */
export const letterEditableProperties: Record<string, unknown> = {
  title: { type: "string", maxLength: 200 }, issue_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10 },
  recipient_name: { type: "string", maxLength: 160 }, recipient_address: { type: "string", maxLength: 400 },
  salutation: { type: "string", maxLength: 200 },
  body: { type: "string", maxLength: 50_000, description: "Optional introduction printed BEFORE the ordered blocks. Changing body does not replace existing block paragraphs. For a complete rewrite, read get_letter, clear body with an empty string and supply the complete replacement blocks." },
  closing: { type: "string", maxLength: 200 },
  signatory_name: { type: "string", maxLength: 160 }, signatory_title: { type: "string", maxLength: 160 },
  template: { type: "string", enum: [...LAYOUTS] }, accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  text_style: { ...textStyleSchema, description: "Update the supplied body formatting properties while preserving unspecified saved properties." },
  title_style: { ...textStyleSchema, description: "Update the supplied title formatting properties while preserving unspecified saved properties." },
  use_letterhead: { type: "boolean" }, show_company_header: { type: "boolean" }, show_logo: { type: "boolean" }, show_reference: { type: "boolean" },
  blocks: { type: "array", maxItems: 100, description: "Ordered letter content. Supplying blocks replaces the ENTIRE saved block list; first read get_letter and preserve unchanged blocks. Internal IDs are generated. Signature/stamp blocks create blank sign-off areas, never apply company images.", items: { type: "object", additionalProperties: false, required: ["type"], properties: {
    type: { type: "string", enum: ["text", "field", "date", "signature", "stamp"] }, text: { type: "string", maxLength: 20_000, description: "Required only for a text paragraph." },
    label: { type: "string", maxLength: 200, description: "Required for field/date/signature/stamp blocks." },
    value: { type: "string", maxLength: 10_000, description: "Required for field/date blocks; unknown facts may be an empty string. Date values use YYYY-MM-DD." }, align: alignmentSchema,
    style: { ...textStyleSchema, description: "Formatting for text/field/date blocks only. Signature/stamp blocks support alignment but no text style." },
  } } },
};

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw argumentError("Use only the supported letter fields.");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw argumentError(`Enter a valid ${label}.`);
  return value;
}

/** Capture the epoch before any permission, asset, database or render await. */
async function execution(signal?: AbortSignal): Promise<() => void> {
  const scope = requireAgentStorageScope(), identity = getCacheIdentity();
  const check = () => {
    signal?.throwIfAborted();
    if (agentStorageScope() !== scope || getCacheIdentity() !== identity)
      throw new DOMException("Workspace changed before completing this letter task.", "AbortError");
  };
  check();
  await requireModuleAccess("letters");
  check();
  return check;
}

function patch(input: unknown): Partial<LetterForm> {
  const args = object(input, PATCH_KEYS), result: Partial<LetterForm> = {};
  for (const key of TEXT_FIELDS)
    if (own(args, key)) result[key] = string(args[key], key.replace(/_/g, " "), key === "body" ? 50_000 : key === "recipient_address" ? 400 : key === "recipient_name" || key === "signatory_name" || key === "signatory_title" ? 160 : 200);
  for (const key of FLAGS) {
    if (!own(args, key)) continue;
    if (typeof args[key] !== "boolean") throw argumentError("Choose valid letter display options.");
    result[key] = args[key];
  }
  if (own(args, "template")) {
    if (!LAYOUTS.includes(args.template as typeof LAYOUTS[number])) throw argumentError("Choose a supported letter layout.");
    result.template = args.template as string;
  }
  for (const key of ["text_style", "title_style"] as const) {
    if (!own(args, key)) continue;
    validateInput(() => validateLetterTextStyle(args[key]));
    if (args[key] === undefined) throw argumentError("Choose valid letter text formatting.");
    result[key] = structuredClone(args[key]) as LetterForm[typeof key];
  }
  if (own(args, "blocks")) {
    if (!Array.isArray(args.blocks) || args.blocks.length > 100) throw argumentError("A letter can have at most 100 blocks.");
    result.blocks = args.blocks.map(value => {
      const block = object(value, ["type", "text", "label", "value", "align", "style"]);
      const type = block.type;
      const allowed = type === "text" ? ["type", "text", "align", "style"]
        : type === "field" || type === "date" ? ["type", "label", "value", "align", "style"]
          : type === "signature" || type === "stamp" ? ["type", "label", "align"] : [];
      object(block, allowed);
      if (!allowed.length) throw argumentError("Choose a supported letter block type.");
      const align = block.align ?? "left";
      if (!["left", "center", "right"].includes(align as string)) throw argumentError("Choose a valid block alignment.");
      if (own(block, "style")) validateInput(() => validateLetterTextStyle(block.style));
      const base = { id: crypto.randomUUID(), align: align as LetterBlock["align"],
        ...(block.style ? { style: structuredClone(block.style) as LetterForm["text_style"] } : {}) };
      if (type === "text") return { ...base, type, text: string(block.text, "paragraph", 20_000) };
      if (type === "field" || type === "date") return { ...base, type,
        label: string(block.label, "field label", 200), value: string(block.value, "field value", type === "date" ? 10 : 10_000) };
      return { ...base, type: type as "signature" | "stamp", label: string(block.label, "sign-off label", 200) };
    });
  }
  validateInput(() => validateLetterForm({ ...blankLetterForm("LTR-PREFLIGHT"), ...result }));
  return result;
}

async function companyContext(check: () => void) {
  const [company, settings] = await Promise.all([billing.getCompany(), tools.settings()]);
  check();
  const setting = (key: string) => {
    const matches = settings.filter(row => row.key === key);
    if (matches.length > 1) throw new Error("Company letter settings could not be verified. Review Company Details.");
    return matches[0]?.value;
  };
  const head = setting("company_letterhead");
  let background = "";
  if (head) {
    try {
      const parsed: unknown = JSON.parse(head);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const value = (parsed as Record<string, unknown>).background;
      if (value !== undefined && typeof value !== "string") throw new Error();
      background = typeof value === "string" ? value : "";
    } catch { throw new Error("Saved company letterhead could not be read. Review Company Details."); }
  }
  const available = (key: string) => {
    const value = setting(key);
    if (!value) return false;
    try {
      const image: unknown = JSON.parse(value);
      return !!image && typeof image === "object" && typeof (image as Record<string, unknown>).data === "string" && !!(image as Record<string, unknown>).data;
    } catch { return false; }
  };
  const formats: DocFormats = {}, format = setting(formatKey("letter"));
  if (format) formats.letter = format;
  return { company, background, formats,
    assets: { letterhead: !!background, logo: !!company.logo, signature: available("company_signature"), stamp: available("company_stamp") } };
}

export async function getAgentLetterContext(args: Record<string, unknown>, signal?: AbortSignal) {
  object(args, []);
  const check = await execution(signal), context = await companyContext(check);
  return { company: { name: context.company.name || "", address: context.company.address || "", email: context.company.email || "",
    phone: context.company.phone || "", trn: context.company.trn || "" }, assets_available: context.assets, layouts: [...LAYOUTS],
    defaults: { status: "draft", use_letterhead: context.assets.letterhead, show_company_header: !context.assets.letterhead, show_logo: context.assets.logo && !context.background,
      show_reference: false, show_signature: false, show_stamp: false, text_style: blankLetterForm("LTR").text_style }, navigation: "/letters" };
}

function missing(form: LetterForm): string[] {
  const fields = ["title", "company_name", "recipient_name", "signatory_name", "signatory_title"] as const;
  const result: string[] = fields.filter(key => !form[key].trim());
  if (!form.body.trim() && !form.blocks.some(block => block.type === "text" ? !!block.text.trim() : (block.type === "field" || block.type === "date") && !!block.value.trim())) result.push("content");
  form.blocks.forEach((block, index) => {
    if ((block.type === "field" || block.type === "date") && !block.value.trim()) result.push(`blocks.${index}.value`);
  });
  return result;
}

function summary(record: LetterRecord) {
  const form = letterDisplayForm(record);
  return { id: record.id, number: form.number, revision: record.revision, title: form.title, status: form.status,
    issue_date: form.issue_date, recipient_name: form.recipient_name, updated_at: record.updated_at, navigation: "/letters",
    url: `#/letters?letter=${encodeURIComponent(record.id)}`, field_names_needing_completion: missing(form) };
}

async function recordById(args: Record<string, unknown>, check: () => void): Promise<LetterRecord> {
  const id = string(args.letter_id, "letter ID from list_letters", 100, true).trim();
  const records = await loadLetters(check);
  check();
  const record = records.find(item => item.id === id);
  if (!record) throw argumentError("No matching letter. Select its exact ID from list_letters.");
  return record;
}

export async function listAgentLetters(args: Record<string, unknown>, signal?: AbortSignal) {
  object(args, ["query", "status", "limit"]);
  const query = args.query === undefined ? "" : string(args.query, "letter search", 200).trim().toLowerCase();
  if (args.status !== undefined && !["draft", "issued"].includes(args.status as string)) throw argumentError("Choose draft or issued letters.");
  const limit = args.limit ?? 50;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) throw argumentError("Choose a letter limit from 1 to 100.");
  const check = await execution(signal), records = await loadLetters(check);
  check();
  const matches = records.filter(record => {
    const form = letterDisplayForm(record);
    return (!args.status || form.status === args.status) && (!query || `${form.number} ${form.title} ${form.recipient_name}`.toLowerCase().includes(query));
  });
  return { count: matches.length, letters: matches.slice(0, limit).map(summary), navigation: "/letters" };
}

export async function getAgentLetter(args: Record<string, unknown>, signal?: AbortSignal) {
  object(args, ["letter_id"]);
  const check = await execution(signal), record = await recordById(args, check), form = letterDisplayForm(record);
  const editable = Object.fromEntries(PATCH_KEYS.map(key => [key, key === "blocks"
    ? form.blocks.map(({ id: _id, ...block }) => block) : form[key as keyof LetterForm]]));
  return { ...summary(record), form: { ...editable, company_name: form.company_name, company_address: form.company_address,
    company_email: form.company_email, company_phone: form.company_phone, company_trn: form.company_trn },
    assets_available: { letterhead: !!form.letterhead?.background, logo: !!form.company_logo, signature: !!form.signature?.data, stamp: !!form.stamp?.data } };
}

function assertImages(form: LetterForm): void {
  if (form.use_letterhead && !form.letterhead?.background) throw argumentError("Add company letterhead in Company Details before enabling it.");
  if (form.show_logo && !form.company_logo) throw argumentError("Add the company logo in Company Details before enabling it.");
}

function applyPatch(form: LetterForm, changes: Partial<LetterForm>): LetterForm {
  return { ...form, ...changes,
    text_style: changes.text_style ? { ...form.text_style, ...changes.text_style } : form.text_style,
    title_style: changes.title_style ? { ...form.title_style, ...changes.title_style } : form.title_style };
}

function savedResult(saved: LetterRecord, form: LetterForm, expectedId?: string, expectedRevision = 1) {
  if (!saved || typeof saved.id !== "string" || !saved.id.trim() || expectedId && saved.id !== expectedId ||
      saved.revision !== expectedRevision || saved.form?.number !== form.number || saved.form.status !== "draft")
    throw new Error("Letter save could not be confirmed. Check Letter before trying again.");
  return { ok: true, ...summary(saved), message: "Draft saved. The letter has not been issued or sent." };
}

export async function createAgentLetterDraft(args: Record<string, unknown>, signal?: AbortSignal) {
  const changes = patch(args);
  string(changes.title, "letter title", 200, true);
  const check = await execution(signal);
  const [context, records] = await Promise.all([companyContext(check), loadLetters(check)]);
  check();
  const form = applyPatch({ ...blankLetterForm("LTR-PREFLIGHT"), company_name: context.company.name || "", company_address: context.company.address || "",
    company_email: context.company.email || "", company_phone: context.company.phone || "", company_trn: context.company.trn || "",
    company_logo: context.company.logo || "", show_logo: !!context.company.logo && !context.background, letterhead: { background: context.background },
    use_letterhead: !!context.background, show_company_header: !context.background, status: "draft", show_signature: false, show_stamp: false }, changes);
  assertImages(form);
  validateInput(() => validateLetterForm(form));
  check();
  form.number = await allocateDocumentNumber("letter", records.map(record => record.form.number), context.formats);
  check();
  validateLetterForm(form);
  check();
  const saved = await saveLetter(form, undefined, undefined, undefined, check);
  check();
  return savedResult(saved, form);
}

export async function reviseAgentLetterDraft(args: Record<string, unknown>, signal?: AbortSignal) {
  object(args, ["letter_id", "expected_revision", "changes"]);
  if (!Number.isSafeInteger(args.expected_revision) || (args.expected_revision as number) < 1) throw argumentError("Provide the current letter revision from get_letter.");
  const changes = patch(args.changes);
  if (!Object.keys(changes).length) throw argumentError("Provide at least one letter change.");
  const check = await execution(signal), record = await recordById(args, check);
  if (record.form.status !== "draft") throw argumentError("Issued letters cannot be edited. Create a new draft instead.");
  if (record.revision !== args.expected_revision) throw argumentError("This letter changed. Read its latest revision before saving.");
  const form = applyPatch(letterDisplayForm(record), changes);
  assertImages(form);
  validateInput(() => validateLetterForm(form));
  check();
  const saved = await saveLetter(form, record.id, record.revision, record.updated_at, check);
  check();
  return savedResult(saved, form, record.id, record.revision + 1);
}

/** The caller registers output with its captured turn ID; no customer delivery. */
export async function exportAgentLetterDraft(args: Record<string, unknown>, signal?: AbortSignal): Promise<{
  result: ReturnType<typeof summary> & { ok: true; file: string; message: string };
  output: DeliveredFile & { documentKey: string };
}> {
  object(args, ["letter_id"]);
  const check = await execution(signal), record = await recordById(args, check), form = letterDisplayForm(record);
  validateLetterForm(form);
  const [{ default: LetterDocument }, { reactToPdfBytes }, { deliverFile }] = await Promise.all([
    import("../components/LetterDocument"), import("./reactPdf"), import("./agentFiles"),
  ]);
  check();
  const name = `${form.number}-${form.title || "letter"}`.replace(/[^\p{L}\p{N}_ .()-]/gu, "-").replace(/^\.+|[. ]+$/g, "").slice(0, 100) || "letter";
  const pdf = await reactToPdfBytes(createElement(LetterDocument, { form }), name);
  check();
  if (!ArrayBuffer.isView(pdf.bytes) || ![37, 80, 68, 70, 45].every((byte, index) => pdf.bytes[index] === byte))
    throw new Error("The letter PDF could not be generated. Open its preview before trying again.");
  const saved = await deliverFile({ name: `${name}.pdf`, bytes: pdf.bytes });
  try { check(); } catch (error) {
    if (saved.url?.startsWith("blob:")) URL.revokeObjectURL(saved.url);
    throw error;
  }
  if (!saved.path && !saved.url) throw new Error("The letter PDF could not be saved. Check the export folder in Settings.");
  return { result: { ok: true, ...summary(record), file: saved.name, message: "Letter PDF exported. Its status is unchanged and it has not been sent." },
    output: { ...saved, documentKey: `letter:${record.id}` } };
}
