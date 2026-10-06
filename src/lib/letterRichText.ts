import type { LetterBlock, LetterForm, LetterTextStyle } from "./letters";
import { fmtDate } from "./format";

/** This is a deliberately small subset of the editor's JSON schema. Never HTML. */
export const LETTER_RICH_FONTS = [
  "Inter",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Lora",
  "IBM Plex Mono",
] as const;
export type LetterRichFont = (typeof LETTER_RICH_FONTS)[number];
export type LetterRichAlignment = "left" | "center" | "right" | "justify";
export interface LetterRichAttributes {
  textAlign?: LetterRichAlignment | null;
  lineSpacing?: number | null;
  paragraphSpacing?: number | null;
  level?: 1 | 2 | 3;
  start?: number | null;
  label?: string;
}
export type LetterRichMark =
  | { type: "bold" | "italic" | "underline" }
  | {
      type: "textStyle";
      attrs: {
        fontFamily?: LetterRichFont | null;
        fontSize?: string | null;
        color?: string | null;
      };
    };
export interface LetterRichNode {
  type:
    | "paragraph"
    | "heading"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "blockquote"
    | "companySignature"
    | "companyStamp"
    | "text"
    | "hardBreak";
  attrs?: LetterRichAttributes;
  content?: LetterRichNode[];
  text?: string;
  marks?: LetterRichMark[];
}
export interface LetterRichDocument {
  type: "doc";
  content: LetterRichNode[];
}

export const LETTER_RICH_LIMITS = {
  text: 250_000,
  nodes: 20_000,
  depth: 16,
  bytes: 2_000_000,
  /** Reserve eleven legacy text chunks so every accepted document remains saveable. */
  companyMarks: 89,
} as const;

const invalid = (): never => {
  throw new Error(
    "Letter document could not be read. Use supported text and formatting options."
  );
};
function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function number(value: unknown, min: number, max: number, integer = false): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    invalid();
}
function unicode(value: string): void {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) invalid();
  }
}
function attributes(value: unknown, type: string): void {
  if (value === undefined) {
    if (type === "heading") invalid();
    return;
  }
  const attrs = record(value);
  if (type === "companySignature" || type === "companyStamp") {
    keys(attrs, ["label", "textAlign"]);
    if (
      typeof attrs.label !== "string" ||
      attrs.label.length > 200 ||
      /[\r\n]/.test(attrs.label)
    )
      invalid();
    unicode(attrs.label as string);
    if (
      attrs.textAlign != null &&
      !["left", "center", "right"].includes(attrs.textAlign as string)
    )
      invalid();
    return;
  }
  if (type === "orderedList") {
    keys(attrs, ["start"]);
    if (attrs.start != null) number(attrs.start, 1, 9999, true);
    return;
  }
  if (type !== "paragraph" && type !== "heading") return invalid();
  keys(
    attrs,
    type === "heading"
      ? ["textAlign", "lineSpacing", "paragraphSpacing", "level"]
      : ["textAlign", "lineSpacing", "paragraphSpacing"]
  );
  if (type === "heading") number(attrs.level, 1, 3, true);
  if (
    attrs.textAlign != null &&
    !["left", "center", "right", "justify"].includes(attrs.textAlign as string)
  )
    invalid();
  if (attrs.lineSpacing != null) number(attrs.lineSpacing, 1, 2.5);
  if (attrs.paragraphSpacing != null) number(attrs.paragraphSpacing, 0, 32);
}
function marks(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 4) return invalid();
  const seen = new Set<string>();
  for (const mark of value) {
    const item = record(mark);
    if (typeof item.type !== "string" || seen.has(item.type)) invalid();
    seen.add(item.type as string);
    if (["bold", "italic", "underline"].includes(item.type as string)) {
      keys(item, ["type"]);
    } else if (item.type === "textStyle") {
      keys(item, ["type", "attrs"]);
      const attrs = record(item.attrs);
      keys(attrs, ["fontFamily", "fontSize", "color"]);
      if (
        attrs.fontFamily != null &&
        !LETTER_RICH_FONTS.includes(attrs.fontFamily as LetterRichFont)
      )
        invalid();
      if (attrs.fontSize != null) {
        if (
          typeof attrs.fontSize !== "string" ||
          !/^\d{1,2}(?:\.\d{1,2})?pt$/.test(attrs.fontSize)
        )
          invalid();
        number(Number.parseFloat(attrs.fontSize as string), 8, 36);
      }
      if (
        attrs.color != null &&
        (typeof attrs.color !== "string" || !/^#[0-9a-f]{6}$/i.test(attrs.color))
      )
        invalid();
    } else invalid();
  }
}

/** Reject unknown nodes/attributes and bound traversal before serializing anything. */
export function validateLetterRichDocument(
  value: unknown
): asserts value is LetterRichDocument {
  const document = record(value);
  keys(document, ["type", "content"]);
  if (
    document.type !== "doc" ||
    !Array.isArray(document.content) ||
    !document.content.length
  )
    invalid();
  let nodes = 0,
    length = 0,
    companyMarks = 0;
  const ancestors = new Set<object>();
  const walk = (raw: unknown, parent: string, depth: number, position: number) => {
    if (++nodes > LETTER_RICH_LIMITS.nodes || depth > LETTER_RICH_LIMITS.depth) invalid();
    const node = record(raw);
    if (ancestors.has(node)) invalid();
    ancestors.add(node);
    keys(node, ["type", "attrs", "content", "text", "marks"]);
    const type = node.type;
    if (typeof type !== "string") invalid();
    const inline = type === "text" || type === "hardBreak";
    if (parent === "paragraph" || parent === "heading") {
      if (!inline) invalid();
    } else if (parent === "bulletList" || parent === "orderedList") {
      if (type !== "listItem") invalid();
    } else {
      if (
        ![
          "paragraph",
          "heading",
          "bulletList",
          "orderedList",
          "blockquote",
          "companySignature",
          "companyStamp",
        ].includes(type as string)
      )
        invalid();
      if (parent === "listItem" && position === 0 && type !== "paragraph") invalid();
    }
    if (type === "text") {
      if (
        node.attrs !== undefined ||
        node.content !== undefined ||
        typeof node.text !== "string" ||
        !node.text.length
      )
        invalid();
      length += (node.text as string).length;
      if (length > LETTER_RICH_LIMITS.text) invalid();
      unicode(node.text as string);
      marks(node.marks);
    } else if (type === "hardBreak") {
      keys(node, ["type"]);
      length++;
      if (length > LETTER_RICH_LIMITS.text) invalid();
    } else if (type === "companySignature" || type === "companyStamp") {
      if (++companyMarks > LETTER_RICH_LIMITS.companyMarks) invalid();
      keys(node, ["type", "attrs"]);
      if (node.attrs === undefined) invalid();
      attributes(node.attrs, type);
    } else {
      if (node.text !== undefined || node.marks !== undefined) invalid();
      attributes(node.attrs, type as string);
      if (node.content !== undefined && !Array.isArray(node.content)) invalid();
      const content = (node.content ?? []) as unknown[];
      if (!["paragraph", "heading"].includes(type as string) && !content.length)
        invalid();
      for (let index = 0; index < content.length; index++)
        walk(content[index], type as string, depth + 1, index);
      // Paragraph/list separators also count toward the printable content bound.
      length++;
      if (length > LETTER_RICH_LIMITS.text) invalid();
    }
    ancestors.delete(node);
  };
  for (let index = 0; index < (document.content as unknown[]).length; index++)
    walk((document.content as unknown[])[index], "doc", 1, index);
  if (
    (document.content as LetterRichNode[]).map(plain).join("\n").length >
    LETTER_RICH_LIMITS.text
  )
    invalid();
  if (
    new TextEncoder().encode(JSON.stringify(document)).length > LETTER_RICH_LIMITS.bytes
  )
    invalid();
}

function plain(node: LetterRichNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "companySignature" || node.type === "companyStamp") return "";
  const children = node.content || [];
  if (node.type === "bulletList" || node.type === "orderedList")
    return children
      .map(
        (child, index) =>
          `${node.type === "bulletList" ? "•" : `${(node.attrs?.start ?? 1) + index}.`} ${plain(child)}`
      )
      .join("\n");
  return children
    .map(plain)
    .join(node.type === "paragraph" || node.type === "heading" ? "" : "\n");
}

/** Used for search/compatibility only. Rendering must retain the rich runs. */
export function letterRichText(document: LetterRichDocument): string {
  validateLetterRichDocument(document);
  return document.content.map(plain).join("\n");
}

const legacyFonts = { modern: "Inter", classic: "Lora", mono: "IBM Plex Mono" } as const;
function legacyParagraph(text: string, style: LetterTextStyle): LetterRichNode {
  const marks: LetterRichMark[] = [];
  for (const type of ["bold", "italic", "underline"] as const)
    if (style[type]) marks.push({ type });
  const attrs: Extract<LetterRichMark, { type: "textStyle" }>["attrs"] = {};
  if (style.font) attrs.fontFamily = legacyFonts[style.font];
  if (style.fontSize != null) attrs.fontSize = `${style.fontSize}pt`;
  if (style.color) attrs.color = style.color;
  if (Object.keys(attrs).length) marks.push({ type: "textStyle", attrs });
  const content: LetterRichNode[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line)
        content.push({ type: "text", text: line, ...(marks.length ? { marks } : {}) });
    });
  return {
    type: "paragraph",
    attrs: {
      textAlign: style.align ?? "left",
      lineSpacing: style.lineSpacing ?? null,
      paragraphSpacing: style.paragraphSpacing ?? null,
    },
    ...(content.length ? { content } : {}),
  };
}

/** Legacy content is converted on edit; old records and issued snapshots are not rewritten. */
export function letterRichDocument(form: LetterForm): LetterRichDocument {
  if (form.rich_document !== undefined) {
    validateLetterRichDocument(form.rich_document);
    return structuredClone(form.rich_document);
  }
  const content: LetterRichNode[] = [];
  const add = (text: string, style: LetterTextStyle = form.text_style || {}) => {
    if (text) content.push(legacyParagraph(text, style));
  };
  add(form.recipient_name);
  add(form.recipient_address);
  if (!form.body.replace(/\r\n?/g, "\n").split("\n").includes(form.title))
    add(form.title, {
      ...form.text_style,
      fontSize: 18,
      bold: true,
      ...form.title_style,
    });
  add(form.salutation);
  if (form.body) content.push(legacyParagraph(form.body, form.text_style || {}));
  let hasSignature = false,
    hasStamp = false;
  for (const block of form.blocks) {
    if (block.type === "signature" || block.type === "stamp") {
      content.push({
        type: block.type === "signature" ? "companySignature" : "companyStamp",
        attrs: { label: block.label, textAlign: block.align },
      });
      hasSignature ||= block.type === "signature";
      hasStamp ||= block.type === "stamp";
      continue;
    }
    const style = { ...form.text_style, align: block.align, ...block.style };
    const text =
      block.type === "text"
        ? block.text
        : block.type === "field" || block.type === "date"
          ? [
              block.label,
              block.type === "date" && block.value ? fmtDate(block.value) : block.value,
            ]
              .filter(Boolean)
              .join(": ")
          : "";
    content.push(legacyParagraph(text, style));
  }
  add(form.closing);
  if (form.show_signature && !hasSignature)
    content.push({ type: "companySignature", attrs: { label: "", textAlign: "left" } });
  add(form.signatory_name, { ...form.text_style, bold: true });
  add(form.signatory_title);
  if (form.show_stamp && !hasStamp)
    content.push({ type: "companyStamp", attrs: { label: "", textAlign: "left" } });
  const document: LetterRichDocument = {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
  validateLetterRichDocument(document);
  return document;
}

/** Keep legacy readers and agent tools useful without truncating a rich draft. */
export function letterRichDocumentToLegacy(
  document: LetterRichDocument
): Pick<LetterForm, "body" | "blocks"> {
  const value = letterRichText(document);
  const boundary = (start: number, size: number) => {
    let end = Math.min(start + size, value.length);
    // PostgreSQL JSON rejects lone surrogates: do not split a Unicode scalar.
    if (
      end < value.length &&
      /[\uD800-\uDBFF]/.test(value.charAt(end - 1)) &&
      /[\uDC00-\uDFFF]/.test(value.charAt(end))
    )
      end--;
    return end;
  };
  const body = value.slice(0, boundary(0, 50_000));
  const blocks: LetterBlock[] = [];
  for (let start = body.length; start < value.length; ) {
    const end = boundary(start, 20_000);
    blocks.push({
      id: `rich-text-${blocks.length + 1}`,
      type: "text",
      text: value.slice(start, end),
      align: "left",
    });
    start = end;
  }
  const visit = (node: LetterRichNode) => {
    if (node.type === "companySignature" || node.type === "companyStamp")
      blocks.push({
        id: `rich-signoff-${blocks.length + 1}`,
        type: node.type === "companySignature" ? "signature" : "stamp",
        label: node.attrs?.label || "",
        align:
          node.attrs?.textAlign === "right" || node.attrs?.textAlign === "center"
            ? node.attrs.textAlign
            : "left",
      });
    node.content?.forEach(visit);
  };
  document.content.forEach(visit);
  return { body, blocks };
}
