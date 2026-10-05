import type { LetterheadInfo } from "../components/Letterhead";
import type { StampSig } from "../components/StampSignature";
import { getCacheIdentity, getCacheScope } from "./api";
import { assertWorkspaceCurrent, effectiveDataMode } from "./dataMode";
import { todayYmd } from "./format";
import { withLocalTransaction } from "./localdb";
import { requireModuleAccess } from "./moduleAccess";
import { notifyDataChanged } from "./realtime";
import { sb, supabase } from "./supabase";

export type LetterAlignment = "left" | "center" | "right";
export interface LetterTextStyle {
  font?: "modern" | "classic" | "mono";
  align?: LetterAlignment;
  /** Font size in points. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  lineSpacing?: number;
  paragraphSpacing?: number;
}
type BlockBase = { id: string; align: LetterAlignment; style?: LetterTextStyle };
export type LetterBlock =
  | (BlockBase & { type: "text"; text: string })
  | (BlockBase & { type: "field"; label: string; value: string })
  | (BlockBase & { type: "date"; label: string; value: string })
  | (BlockBase & { type: "signature" | "stamp"; label: string });

export interface LetterForm {
  number: string;
  title: string;
  issue_date: string;
  status: "draft" | "issued";
  template: string;
  accent: string;
  font: string;
  /** Omitted legacy flags retain the previous visible header/reference. */
  show_reference?: boolean;
  show_company_header?: boolean;
  text_style?: LetterTextStyle;
  title_style?: LetterTextStyle;
  company_name: string;
  company_address: string;
  company_trn: string;
  company_phone: string;
  company_email: string;
  company_logo: string;
  recipient_name: string;
  recipient_address: string;
  salutation: string;
  /** Optional introduction before the ordered custom blocks. Plain text only. */
  body: string;
  closing: string;
  signatory_name: string;
  signatory_title: string;
  show_logo: boolean;
  show_stamp: boolean;
  show_signature: boolean;
  use_letterhead: boolean;
  letterhead?: LetterheadInfo;
  stamp?: StampSig;
  signature?: StampSig;
  blocks: LetterBlock[];
}

export interface LetterRecord {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  form: LetterForm;
  issued_at: string | null;
  /** Content, layout and durable company asset references frozen on issue. */
  issued_snapshot: LetterForm | null;
}

export const LETTER_SETTING_KEY = "letters";
let writes: Promise<unknown> = Promise.resolve();

export function blankLetterForm(number: string): LetterForm {
  return {
    number,
    title: "",
    issue_date: todayYmd(),
    status: "draft",
    template: "letter-standard",
    accent: "#222222",
    font: "'Plus Jakarta Sans', system-ui, sans-serif",
    show_reference: false,
    show_company_header: true,
    text_style: { font: "modern", fontSize: 11, lineSpacing: 1.5, paragraphSpacing: 16 },
    title_style: { font: "modern", fontSize: 18, bold: true },
    company_name: "",
    company_address: "",
    company_trn: "",
    company_phone: "",
    company_email: "",
    company_logo: "",
    recipient_name: "",
    recipient_address: "",
    salutation: "",
    body: "",
    closing: "Yours sincerely,",
    signatory_name: "",
    signatory_title: "",
    show_logo: false,
    show_stamp: false,
    show_signature: false,
    use_letterhead: false,
    blocks: [{ id: crypto.randomUUID(), type: "text", text: "", align: "left" }],
  };
}

function text(
  value: unknown,
  label: string,
  max: number,
  required = false,
  multiline = false
): void {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw new Error(
      `${label} ${required ? "is required and " : ""}must be at most ${max} characters.`
    );
  if (!multiline && /[\r\n]/.test(value))
    throw new Error(`${label} must be a single line.`);
}

function validDate(value: unknown, optional = false): boolean {
  if (optional && value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Keep private object paths, never the expiring URL/token used to preview them. */
function durableAsset(value: string): string {
  if (!value) return value;
  const signed = value.match(
    /^https?:\/\/[^/]+\/storage\/v1\/object\/sign\/files\/(.+?)(?:\?|$)/
  );
  if (signed) {
    try {
      value = decodeURIComponent(signed[1]);
    } catch {
      throw new Error("Company asset could not be read.");
    }
  }
  if (/^data:image\//i.test(value)) return value;
  if (
    /^[^\s/?#\\]+\/company\/[^?#\\]+$/.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  )
    return value;
  throw new Error(
    "Use a saved company image. Temporary URLs cannot be saved on a letter."
  );
}

function validateAsset(asset: StampSig | undefined): void {
  if (!asset) return;
  text(asset.data, "Stamp or signature", 5_000_000, false, true);
  durableAsset(asset.data);
  text(asset.color, "Stamp or signature color", 100);
  for (const key of [
    "x",
    "y",
    "opacity",
    "cropTop",
    "cropRight",
    "cropBottom",
    "cropLeft",
    "scale",
  ] as const)
    if (
      !Number.isFinite(asset[key]) ||
      asset[key] < 0 ||
      asset[key] > (key === "scale" ? 500 : 100)
    )
      throw new Error("Stamp or signature adjustments could not be read.");
}

export function validateLetterTextStyle(style: unknown): void {
  if (style === undefined) return;
  const invalid = () => {
    throw new Error(
      "Letter text formatting could not be read. Choose valid font, size, color and spacing options."
    );
  };
  if (
    !style ||
    typeof style !== "object" ||
    Array.isArray(style) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(style))
  )
    return invalid();
  const value = style as Record<string, unknown>;
  const keys = new Set([
    "font",
    "align",
    "fontSize",
    "bold",
    "italic",
    "underline",
    "color",
    "lineSpacing",
    "paragraphSpacing",
  ]);
  if (Object.keys(value).some((key) => !keys.has(key))) return invalid();
  if (
    value.font !== undefined &&
    !["modern", "classic", "mono"].includes(value.font as string)
  )
    return invalid();
  if (
    value.align !== undefined &&
    !["left", "center", "right"].includes(value.align as string)
  )
    return invalid();
  if (
    value.color !== undefined &&
    (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color))
  )
    return invalid();
  for (const key of ["bold", "italic", "underline"])
    if (value[key] !== undefined && typeof value[key] !== "boolean") return invalid();
  for (const [key, min, max] of [
    ["fontSize", 8, 36],
    ["lineSpacing", 1, 2.5],
    ["paragraphSpacing", 0, 32],
  ] as const)
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < min ||
        value[key] > max)
    )
      return invalid();
}

export function validateLetterForm(form: LetterForm): void {
  if (!form || typeof form !== "object")
    throw new Error("Letter data could not be read.");
  if (!["draft", "issued"].includes(form.status))
    throw new Error("Choose a valid letter status.");
  const issued = form.status === "issued";
  text(form.number, "Letter number", 100, true);
  text(form.title, "Letter title", 200, issued);
  for (const key of [
    "company_name",
    "recipient_name",
    "signatory_name",
    "signatory_title",
  ] as const)
    text(form[key], key.replace(/_/g, " "), 160);
  for (const key of ["company_address", "recipient_address"] as const) {
    text(form[key], key.replace(/_/g, " "), 400, false, true);
    if (form[key].split(/\r\n?|\n/).length > 6)
      throw new Error("Addresses must be at most six lines.");
  }
  text(form.company_trn, "Company tax number", 60);
  text(form.company_phone, "Company phone", 40);
  text(form.company_email, "Company email", 254);
  text(form.company_logo, "Company logo", 5_000_000, false, true);
  durableAsset(form.company_logo);
  for (const key of ["salutation", "closing"] as const) text(form[key], key, 200);
  text(form.body, "Letter body", 50_000, false, true);
  text(form.font, "Font", 250);
  text(form.template, "Template", 100, true);
  if (!/^#[0-9a-f]{6}$/i.test(form.accent))
    throw new Error("Choose a valid accent color.");
  if (!validDate(form.issue_date)) throw new Error("Enter a valid letter date.");
  for (const key of [
    "show_logo",
    "show_stamp",
    "show_signature",
    "use_letterhead",
  ] as const)
    if (typeof form[key] !== "boolean")
      throw new Error("Letter display options could not be read.");
  for (const key of ["show_reference", "show_company_header"] as const)
    if (form[key] !== undefined && typeof form[key] !== "boolean")
      throw new Error("Letter display options could not be read.");
  validateLetterTextStyle(form.text_style);
  validateLetterTextStyle(form.title_style);
  validateAsset(form.stamp);
  validateAsset(form.signature);
  if (form.letterhead) {
    text(form.letterhead.background, "Company letterhead", 5_000_000, false, true);
    durableAsset(form.letterhead.background);
  }
  if (
    issued &&
    ((form.show_stamp && !form.stamp?.data) ||
      (form.show_signature && !form.signature?.data) ||
      (form.use_letterhead && !form.letterhead?.background))
  )
    throw new Error(
      "A selected company image is missing. Reload company assets or turn that option off before issuing."
    );
  if (!Array.isArray(form.blocks) || form.blocks.length > 100)
    throw new Error("A letter can have at most 100 blocks.");
  const ids = new Set<string>();
  let length = form.body.length;
  let content = !!form.body.trim();
  for (const block of form.blocks) {
    if (!block || typeof block !== "object")
      throw new Error("Letter blocks could not be read.");
    text(block.id, "Block ID", 100, true);
    if (ids.has(block.id)) throw new Error("Each letter block needs a unique ID.");
    ids.add(block.id);
    if (!["left", "center", "right"].includes(block.align))
      throw new Error("Choose a valid block alignment.");
    validateLetterTextStyle(block.style);
    if (block.type === "text") {
      text(block.text, "Text block", 20_000, false, true);
      length += block.text.length;
      content ||= !!block.text.trim();
    } else if (block.type === "field" || block.type === "date") {
      text(block.label, "Field label", 200);
      text(
        block.value,
        "Field value",
        block.type === "date" ? 10 : 10_000,
        false,
        block.type !== "date"
      );
      if (block.type === "date" && !validDate(block.value, !issued))
        throw new Error("Enter a valid date for each date block.");
      length += block.label.length + block.value.length;
      content ||= !!block.value.trim();
    } else if (block.type === "signature" || block.type === "stamp") {
      text(block.label, "Sign-off label", 200);
    } else throw new Error("Choose a valid letter block type.");
  }
  if (length > 250_000)
    throw new Error("Letter content must be at most 250000 characters.");
  if (issued && !content) throw new Error("Add letter content before issuing.");
}

function savedForm(form: LetterForm): LetterForm {
  const clean = structuredClone(form);
  clean.company_logo = durableAsset(clean.company_logo);
  if (clean.letterhead)
    clean.letterhead = { background: durableAsset(clean.letterhead.background) };
  for (const key of ["stamp", "signature"] as const) {
    if (!clean[key]) continue;
    const { _previewUrl: _drop, ...asset } = clean[key];
    clean[key] = { ...asset, data: durableAsset(asset.data) };
  }
  return clean;
}

export function letterDisplayForm(record: LetterRecord): LetterForm {
  if (record.form.status === "issued") {
    if (!record.issued_snapshot)
      throw new Error(
        "This issued letter has no saved snapshot. Its original data has been preserved."
      );
    return structuredClone(record.issued_snapshot);
  }
  return structuredClone(record.form);
}

function scope(expected?: string): string {
  assertWorkspaceCurrent();
  const account = getCacheScope();
  if (!account) throw new Error("Sign in to load or save letters.");
  const current = `${effectiveDataMode()}:${account}`;
  if (expected && current !== expected)
    throw new Error("Your workspace changed. Reopen Letter before continuing.");
  if (
    current.startsWith("cloud:") &&
    typeof navigator !== "undefined" &&
    !navigator.onLine
  )
    throw new Error("Connect to the internet to load or save cloud letters.");
  return current;
}

function parseRecords(value: string | undefined): LetterRecord[] {
  if (value === undefined) return [];
  try {
    const records: unknown = JSON.parse(value);
    if (!Array.isArray(records)) throw new Error("Invalid collection");
    const ids = new Set<string>();
    for (const record of records) {
      if (
        !record ||
        typeof record.id !== "string" ||
        !record.id ||
        ids.has(record.id) ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 1 ||
        typeof record.created_at !== "string" ||
        !Number.isFinite(Date.parse(record.created_at)) ||
        typeof record.updated_at !== "string" ||
        !Number.isFinite(Date.parse(record.updated_at))
      )
        throw new Error("Invalid record");
      validateLetterForm(record.form);
      if (record.form.status === "issued") {
        if (
          typeof record.issued_at !== "string" ||
          !Number.isFinite(Date.parse(record.issued_at)) ||
          !record.issued_snapshot ||
          record.issued_snapshot.status !== "issued" ||
          record.issued_snapshot.number !== record.form.number
        )
          throw new Error("Invalid issued snapshot");
        validateLetterForm(record.issued_snapshot);
      } else if (record.issued_at !== null || record.issued_snapshot !== null)
        throw new Error("Invalid draft snapshot");
      ids.add(record.id);
    }
    return records;
  } catch {
    throw new Error(
      "Saved letters could not be read. The original data has been preserved."
    );
  }
}

/** Capture the account generation as well as its name. A queued operation must
 * not become valid again after switching away from a workspace and back. */
function executionCheck(assertCurrent?: () => void): () => void {
  const identity = getCacheIdentity();
  return () => {
    assertCurrent?.();
    if (identity !== getCacheIdentity())
      throw new Error("Your workspace changed. Reopen Letter before continuing.");
  };
}

async function settingRow(expected: string, client: ReturnType<typeof sb>, assertCurrent: () => void) {
  const check = () => { scope(expected); assertCurrent(); };
  check();
  await requireModuleAccess("letters");
  check();
  let userId: string | undefined, orgId: string | undefined;
  if (expected.startsWith("cloud:")) {
    const { data, error } = await supabase!.auth.getSession();
    check();
    if (error) throw error;
    userId = data.session?.user.id;
    const account = getCacheScope()!;
    if (!userId || !account.endsWith(`:user:${userId}`))
      throw new Error("Your cloud account changed. Sign in before using letters.");
    orgId = account.slice(0, -`:user:${userId}`.length);
  }
  let query = client
    .from("app_settings")
    .select("id,value,sync_revision")
    .eq("key", LETTER_SETTING_KEY);
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query.limit(2);
  check();
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 1)
    throw new Error(
      "Saved letters have duplicate settings. The original data has been preserved."
    );
  const row = data[0] as
    | { id: number; value: string; sync_revision?: number }
    | undefined;
  if (
    data.length &&
    (!row ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      typeof row.value !== "string")
  )
    throw new Error(
      "Saved letters could not be read. The original data has been preserved."
    );
  if (
    orgId &&
    row &&
    (!Number.isSafeInteger(row.sync_revision) || row.sync_revision! < 1)
  )
    throw new Error(
      "Cloud letter revisions could not be verified. Ask your administrator to update the cloud database before saving."
    );
  return { row, records: parseRecords(row?.value), userId, orgId };
}

export async function loadLetters(assertCurrent?: () => void): Promise<LetterRecord[]> {
  const expected = scope();
  const check = executionCheck(assertCurrent);
  check();
  return (await settingRow(expected, sb(), check)).records;
}

async function changeRecords<T>(
  expected: string,
  change: (records: LetterRecord[]) => { records: LetterRecord[]; result: T },
  client: ReturnType<typeof sb>,
  assertCurrent: () => void
): Promise<T> {
  // Low-volume correspondence shares one JSON setting; CAS preserves edits
  // from another window without adding a separate document/sync subsystem.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { row, records, userId, orgId } = await settingRow(expected, client, assertCurrent);
    assertCurrent();
    const next = change(records);
    scope(expected);
    assertCurrent();
    const value = JSON.stringify(next.records);
    if (row) {
      let query = client.from("app_settings").update({ value }).eq("id", row.id);
      query = orgId
        ? query.eq("org_id", orgId).eq("sync_revision", row.sync_revision!)
        : query.eq("value", row.value);
      assertCurrent();
      const { data, error } = await query.select("id").maybeSingle();
      scope(expected);
      assertCurrent();
      if (error) throw error; // Unknown write outcomes must never be retried.
      if (!data) continue;
      if (!["number", "string"].includes(typeof data.id) || !Number.isSafeInteger(Number(data.id)) || Number(data.id) <= 0 || Number(data.id) !== row.id)
        throw new Error("The letter save could not be confirmed. Check your letters before trying again.");
    } else {
      assertCurrent();
      const { data, error } = await client
        .from("app_settings")
        .insert({
          key: LETTER_SETTING_KEY,
          value,
          ...(userId ? { user_id: userId, org_id: orgId } : {}),
        })
        .select("id")
        .single();
      scope(expected);
      assertCurrent();
      if (error?.code === "23505") continue;
      if (error) throw error;
      if (!data || !["number", "string"].includes(typeof data.id) || !Number.isSafeInteger(Number(data.id)) || Number(data.id) <= 0)
        throw new Error("The letter save could not be confirmed. Check your letters before trying again.");
    }
    return next.result;
  }
  throw new Error("Letters changed in another window. Reload and try again.");
}

function mutate<T>(
  change: (records: LetterRecord[]) => { records: LetterRecord[]; result: T },
  assertCurrent?: () => void
): Promise<T> {
  const expected = scope();
  const check = executionCheck(assertCurrent);
  const operation = writes.then(async () => {
    scope(expected);
    check();
    const client = sb();
    const result = expected.startsWith("local:")
      ? await withLocalTransaction((tx) =>
          changeRecords(expected, change, tx as unknown as ReturnType<typeof sb>, check)
        )
      : await changeRecords(expected, change, client, check);
    scope(expected);
    check();
    notifyDataChanged(["app_settings"]);
    return result;
  });
  writes = operation.then(
    () => {},
    () => {}
  );
  return operation;
}

export async function saveLetter(
  form: LetterForm,
  id?: string,
  expectedRevision?: number,
  expectedUpdatedAt?: string,
  assertCurrent?: () => void
): Promise<LetterRecord> {
  validateLetterForm(form);
  const content = savedForm(form);
  const recordId = id || crypto.randomUUID();
  return mutate((records) => {
    const previous = records.find((record) => record.id === recordId);
    if (
      id &&
      (!previous ||
        !Number.isSafeInteger(expectedRevision) ||
        previous.revision !== expectedRevision ||
        previous.updated_at !== expectedUpdatedAt)
    )
      throw new Error("This letter changed or was deleted. Reload it before saving.");
    if (previous?.form.status === "issued")
      throw new Error(
        "Issued letters cannot be edited. Duplicate this letter into a new draft."
      );
    if (
      records.some(
        (record) =>
          record.id !== recordId &&
          record.form.number.trim().toLowerCase() === content.number.trim().toLowerCase()
      )
    )
      throw new Error("This letter number is already in use. Choose another number.");
    if (previous?.revision === Number.MAX_SAFE_INTEGER)
      throw new Error(
        "This letter revision is too large. The original data has been preserved."
      );
    const now = new Date(
      Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)
    ).toISOString();
    const record: LetterRecord = {
      id: recordId,
      revision: (previous?.revision ?? 0) + 1,
      created_at: previous?.created_at ?? now,
      updated_at: now,
      form: content,
      issued_at: content.status === "issued" ? now : null,
      issued_snapshot: content.status === "issued" ? structuredClone(content) : null,
    };
    return {
      records: [record, ...records.filter((item) => item.id !== recordId)],
      result: record,
    };
  }, assertCurrent);
}

export async function deleteLetter(
  id: string,
  expectedRevision: number,
  expectedUpdatedAt: string
): Promise<void> {
  return mutate((records) => {
    const previous = records.find((record) => record.id === id);
    if (
      !previous ||
      !Number.isSafeInteger(expectedRevision) ||
      previous.revision !== expectedRevision ||
      previous.updated_at !== expectedUpdatedAt
    )
      throw new Error("This letter changed or was deleted. Reload it before deleting.");
    return { records: records.filter((record) => record.id !== id), result: undefined };
  });
}
