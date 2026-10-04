import { useEffect, useReducer, type CSSProperties, type RefObject } from "react";
import { fmtDate } from "../lib/format";
import type { LetterAlignment, LetterForm, LetterTextStyle } from "../lib/letters";
import { CompanyAssetImage } from "./CompanyAssetImage";
import { A4_H, A4_W } from "./InvoiceExportSheet";
import {
  DEFAULT_FOOTER_SPACE,
  DEFAULT_HEADER_SPACE,
  DEFAULT_SIDE_SPACE,
  LetterheadFrame,
} from "./Letterhead";
import type { StampSig } from "./StampSignature";
import type { CompanyStampSig } from "./StampSignatureSettings";
import "./LetterDocument.css";

export const LETTER_TEMPLATES = [
  {
    id: "letter-standard",
    label: "Company Letter",
    description: "A clean business letter with a ruled company header.",
  },
  {
    id: "letter-modern",
    label: "Modern Note",
    description: "An open header, accent detail, and a clear subject line.",
  },
  {
    id: "letter-formal",
    label: "Formal Correspondence",
    description: "A centered letterhead and a restrained double rule.",
  },
] as const;

type PartKind =
  | "company"
  | "contact"
  | "reference"
  | "recipient"
  | "title"
  | "salutation"
  | "body"
  | "text"
  | "label"
  | "field"
  | "date"
  | "closing"
  | "signatory"
  | "signature"
  | "stamp"
  | "logo";
export interface LetterPart {
  id: string;
  sourceId: string;
  kind: PartKind;
  /** Retains the original text, including line breaks, across page boundaries. */
  text: string;
  align: LetterAlignment;
  size: number;
  lineHeight: number;
  weight: number;
  gap: number;
  height: number;
  asset?: StampSig;
  width?: number;
  font?: string;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}
export interface LetterPage {
  parts: LetterPart[];
  usedHeight: number;
  availableHeight: number;
}

const context =
  typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
const layoutId = (form: LetterForm) =>
  LETTER_TEMPLATES.some((template) => template.id === form.template)
    ? form.template
    : "letter-standard";
const hasBackground = (form: LetterForm) =>
  form.use_letterhead && !!form.letterhead?.background;
const bodyWidth = (form: LetterForm) =>
  A4_W - (hasBackground(form) ? DEFAULT_SIDE_SPACE : 48) * 2;
const safeFont = (form: LetterForm) =>
  form.font && /^[\w\s,'"-]+$/.test(form.font) ? form.font : "Inter, Arial, sans-serif";
const STYLE_FONTS = {
  modern: "Inter, Arial, sans-serif",
  classic: "'Lora', Georgia, serif",
  mono: "'IBM Plex Mono', monospace",
};
const mergedStyle = (
  global?: LetterTextStyle,
  local?: LetterTextStyle
): LetterTextStyle => ({
  ...global,
  ...Object.fromEntries(
    Object.entries(local || {}).filter(([, value]) => value !== undefined)
  ),
});

/** Wrap at words when possible, and split long tokens rather than clip them. */
function wrapText(
  text: string,
  width: number,
  font: string,
  size: number,
  weight: number,
  italic = false
): string[] {
  if (!text) return [];
  if (context) context.font = `${italic ? "italic " : ""}${weight} ${size}px ${font}`;
  const measure = (value: string) =>
    context
      ? context.measureText(value.replace(/\t/g, "    ")).width * 1.1
      : Array.from(value).reduce(
          (sum, character) =>
            sum +
            (character.codePointAt(0)! > 255
              ? 1.05
              : /monospace/.test(font)
                ? 0.62
                : /[MWmw@%&]/.test(character)
                  ? 0.92
                  : /[ilI1.,:;!'| ]/.test(character)
                    ? 0.36
                    : 0.68),
          0
        ) *
        size *
        (weight >= 600 ? 1.05 : 1) *
        (italic ? 1.04 : 1);
  const result: string[] = [];
  for (const paragraph of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    let line = "";
    for (const token of paragraph.match(/\S+[^\S\n]*|[^\S\n]+|\n/gu) || []) {
      if (token === "\n") {
        line += token;
        continue;
      }
      if (line && measure(line + token) > width) {
        result.push(line);
        line = "";
      }
      for (const character of Array.from(token)) {
        if (line && measure(line + character) > width) {
          result.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

/** An issued letter can only use the company images saved in its snapshot. */
function withDraftAssets(
  form: LetterForm,
  companyStampSig?: CompanyStampSig
): LetterForm {
  if (form.status === "issued" || !companyStampSig) return form;
  return {
    ...form,
    stamp: form.stamp || companyStampSig.stamp,
    signature: form.signature || companyStampSig.signature,
  };
}

function flowParts(form: LetterForm): LetterPart[] {
  const parts: LetterPart[] = [];
  const width = bodyWidth(form);
  const font = safeFont(form);
  const add = (
    sourceId: string,
    kind: PartKind,
    text: string,
    options: {
      align?: LetterAlignment;
      size?: number;
      lineHeight?: number;
      weight?: number;
      gap?: number;
      width?: number;
      style?: LetterTextStyle;
      initialParagraphGap?: boolean;
    } = {}
  ) => {
    const {
      size: defaultSize = 13,
      lineHeight: defaultLineHeight = 22,
      weight: defaultWeight = 400,
      gap: defaultGap = 0,
      style = {},
    } = options;
    const align = style.align ?? options.align ?? "left";
    const partFont = (style.font && STYLE_FONTS[style.font]) || font;
    const size = Number.isFinite(style.fontSize)
      ? (Math.max(8, Math.min(36, style.fontSize!)) * 4) / 3
      : defaultSize;
    const weight = style.bold === undefined ? defaultWeight : style.bold ? 700 : 400;
    const lineHeight =
      style.lineSpacing != null
        ? size * Math.max(1, Math.min(2.5, style.lineSpacing))
        : style.fontSize != null
          ? (size * defaultLineHeight) / defaultSize
          : defaultLineHeight;
    const paragraphGap =
      style.paragraphSpacing != null
        ? Math.max(0, Math.min(32, style.paragraphSpacing))
        : undefined;
    const lines = wrapText(
      text,
      options.width ?? width,
      partFont,
      size,
      weight,
      style.italic
    );
    lines.forEach((line, index) =>
      parts.push({
        id: `${sourceId}-${index}`,
        sourceId,
        kind,
        text: line,
        align,
        size,
        lineHeight,
        weight,
        font: partFont,
        italic: style.italic,
        underline: style.underline,
        color:
          style.color && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : undefined,
        gap: index
          ? lines[index - 1].endsWith("\n")
            ? (paragraphGap ?? 0)
            : 0
          : options.initialParagraphGap === false
            ? defaultGap
            : (paragraphGap ?? defaultGap),
        height: lineHeight,
      })
    );
  };
  const addMark = (
    sourceId: string,
    kind: "signature" | "stamp",
    label: string,
    align: LetterAlignment,
    manual = false
  ) => {
    const enabled = kind === "signature" ? form.show_signature : form.show_stamp;
    const asset = enabled && form[kind]?.data ? form[kind] : undefined;
    if (!asset && !manual) return;
    const labels = wrapText(
      label || (manual ? (kind === "signature" ? "Signature" : "Company stamp") : ""),
      width,
      font,
      10,
      600
    );
    if (!asset) {
      parts.push({
        id: sourceId,
        sourceId,
        kind,
        text: labels.join("\n"),
        align,
        size: 10,
        lineHeight: 16,
        weight: 600,
        gap: 14,
        height: (kind === "signature" ? 64 : 96) + labels.length * 16,
        width: kind === "signature" ? 180 : 110,
      });
      return;
    }
    const scale = Number.isFinite(asset.scale)
      ? Math.max(0, Math.min(500, asset.scale))
      : 100;
    const markWidth = Math.min(width, ((kind === "signature" ? 180 : 110) * scale) / 100);
    if (!markWidth) return;
    const markHeight = Math.min(360, markWidth * (kind === "signature" ? 0.5 : 1));
    // Label and image travel together, including when a custom block starts a page.
    parts.push({
      id: sourceId,
      sourceId,
      kind,
      text: labels.join("\n"),
      align,
      size: 10,
      lineHeight: 16,
      weight: 600,
      gap: 14,
      height: markHeight + labels.length * 16,
      asset,
      width: markWidth,
    });
  };
  const formal = layoutId(form) === "letter-formal";
  const brandAlign = formal ? "center" : "left";
  // Explicit new switches are independent. Older letterhead snapshots retain
  // their background-only branding instead of gaining a second logo.
  if (
    form.show_logo &&
    form.company_logo &&
    (form.show_company_header !== undefined || !hasBackground(form))
  )
    parts.push({
      id: "company-logo",
      sourceId: "company-logo",
      kind: "logo",
      text: "",
      align: brandAlign,
      size: 0,
      lineHeight: 0,
      weight: 0,
      gap: 0,
      height: 68,
      width: 130,
    });
  if (form.show_company_header ?? !hasBackground(form)) {
    add("company-name", "company", form.company_name || "Your company", {
      align: brandAlign,
      size: 20,
      lineHeight: 28,
      weight: 700,
    });
    add("company-address", "contact", form.company_address, {
      align: brandAlign,
      size: 10.5,
      lineHeight: 16,
    });
    add(
      "company-tax",
      "contact",
      form.company_trn ? `Tax registration: ${form.company_trn}` : "",
      { align: brandAlign, size: 10.5, lineHeight: 16 }
    );
    add(
      "company-contact",
      "contact",
      [form.company_phone, form.company_email].filter(Boolean).join(" · "),
      { align: brandAlign, size: 10.5, lineHeight: 16 }
    );
  }
  add(
    "reference",
    "reference",
    `${form.show_reference === false ? "" : `Reference: ${form.number || "—"}    `}Date: ${fmtDate(form.issue_date)}`,
    { size: 10.5, lineHeight: 18, gap: 24 }
  );
  add("recipient-name", "recipient", form.recipient_name, { weight: 600, gap: 22 });
  add("recipient-address", "recipient", form.recipient_address, {
    size: 12,
    lineHeight: 20,
  });
  add("title", "title", form.title || "Letter", {
    size: 23,
    lineHeight: 32,
    weight: layoutId(form) === "letter-modern" ? 500 : 650,
    gap: 26,
    style: form.title_style,
  });
  add("salutation", "salutation", form.salutation, { gap: 20, style: form.text_style });
  add("body", "body", form.body, { gap: 16, style: form.text_style });
  for (const block of form.blocks) {
    const style = mergedStyle(form.text_style, block.style);
    if (block.type === "text")
      add(block.id, "text", block.text, { align: block.align, gap: 16, style });
    else if (block.type === "field" || block.type === "date") {
      add(`${block.id}-label`, "label", block.label, {
        align: style.align ?? block.align,
        size: 10,
        lineHeight: 16,
        weight: 600,
        gap: style.paragraphSpacing ?? 16,
        style: { font: style.font },
      });
      add(
        block.id,
        block.type,
        block.type === "date" && block.value ? fmtDate(block.value) : block.value,
        { align: block.align, style, initialParagraphGap: false }
      );
    } else addMark(block.id, block.type, block.label, style.align ?? block.align, true);
  }
  add("closing", "closing", form.closing, { gap: 28, style: form.text_style });
  if (!form.blocks.some((block) => block.type === "signature"))
    addMark("closing-signature", "signature", "", form.text_style?.align ?? "left");
  add("signatory-name", "signatory", form.signatory_name, {
    weight: 600,
    gap: 10,
    style: form.text_style,
  });
  add("signatory-title", "signatory", form.signatory_title, {
    size: 12,
    lineHeight: 20,
    style: form.text_style,
  });
  if (!form.blocks.some((block) => block.type === "stamp"))
    addMark("closing-stamp", "stamp", "", form.text_style?.align ?? "left");
  return parts;
}

/** Each sheet has a measured content budget; even a single large text block can continue. */
export function paginateLetter(
  form: LetterForm,
  companyStampSig?: CompanyStampSig
): LetterPage[] {
  form = withDraftAssets(form, companyStampSig);
  const plainHeight = A4_H - 96;
  const frameHeight = hasBackground(form)
    ? A4_H - DEFAULT_HEADER_SPACE - DEFAULT_FOOTER_SPACE
    : plainHeight;
  const continuedHeader = 46;
  const footer = 38;
  const pages: LetterPage[] = [
    { parts: [], usedHeight: 0, availableHeight: frameHeight - footer },
  ];
  for (const original of flowParts(form)) {
    let page = pages[pages.length - 1];
    if (
      page.parts.length &&
      page.usedHeight + original.gap + original.height > page.availableHeight
    ) {
      page = {
        parts: [],
        usedHeight: 0,
        availableHeight: frameHeight - continuedHeader - footer,
      };
      pages.push(page);
    }
    const part = page.parts.length ? original : { ...original, gap: 0 };
    page.parts.push(part);
    page.usedHeight += part.gap + part.height;
  }
  return pages;
}

export function useLetterPages(
  form: LetterForm,
  companyStampSig?: CompanyStampSig
): LetterPage[] {
  const [, refresh] = useReducer((value) => value + 1, 0);
  useEffect(() => {
    let active = true;
    const fonts = document.fonts;
    if (!fonts) return;
    const loaded = () => {
      if (active) refresh();
    };
    void fonts.ready.then(loaded);
    fonts.addEventListener("loadingdone", loaded);
    return () => {
      active = false;
      fonts.removeEventListener("loadingdone", loaded);
    };
  }, []);
  return paginateLetter(form, companyStampSig);
}

function Mark({ part }: { part: LetterPart }) {
  const asset = part.asset;
  const labelHeight = part.text ? part.text.split("\n").length * 16 : 0;
  return (
    <div className="letter-mark" style={{ textAlign: part.align }}>
      {part.text && (
        <div className="letter-mark-label" style={{ height: labelHeight }}>
          {part.text}
        </div>
      )}
      <div
        data-doc-mark={
          asset ? (part.kind === "signature" ? "Signature" : "Stamp") : undefined
        }
        data-letter-manual-mark={!asset ? part.kind : undefined}
        className={!asset ? `letter-manual-mark letter-manual-${part.kind}` : undefined}
        style={{
          display: "inline-block",
          width: part.width,
          height: part.height - labelHeight,
        }}
      >
        {asset && (
          <CompanyAssetImage
            src={asset.data}
            alt={part.kind === "signature" ? "Signature" : "Company stamp"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: Math.max(0, Math.min(100, asset.opacity)) / 100,
              mixBlendMode: "multiply",
              clipPath: `inset(${asset.cropTop}% ${asset.cropRight}% ${asset.cropBottom}% ${asset.cropLeft}%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function LetterDocument({
  form,
  companyStampSig,
  pageIndex,
  documentRef,
}: {
  form: LetterForm;
  companyStampSig?: CompanyStampSig;
  /** Blocks flow in their saved order; image adjustments are edited in the document form. */
  onChange?: (form: LetterForm) => void;
  pageIndex?: number;
  documentRef?: RefObject<HTMLDivElement | null>;
}) {
  const pages = useLetterPages(form, companyStampSig);
  const background = hasBackground(form);
  const selectedIndex = Math.min(
    Math.max(0, Number.isFinite(pageIndex) ? Math.floor(pageIndex!) : 0),
    pages.length - 1
  );
  const selected =
    pageIndex == null
      ? pages.map((page, index) => ({ page, index }))
      : [{ page: pages[selectedIndex], index: selectedIndex }];
  const sheets = (
    <>
      {selected.map(({ page, index }) => (
        <div
          key={index}
          className={`invoice-print letter-sheet ${layoutId(form)}${background ? " letter-with-background" : ""}`}
          data-letter-page={index + 1}
          data-letter-template={layoutId(form)}
          data-pdf-single="true"
          data-no-i18n
          dir="ltr"
          style={
            {
              width: A4_W,
              height: A4_H,
              fontFamily: safeFont(form),
              "--letter-accent": /^#[0-9a-f]{6}$/i.test(form.accent)
                ? form.accent
                : "#222222",
            } as CSSProperties
          }
        >
          {background && (
            <CompanyAssetImage
              src={form.letterhead!.background}
              alt="Company letterhead"
              className="letter-background"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "fill",
              }}
            />
          )}
          <LetterheadFrame
            enabled={false}
            bodyPadding={0}
            bodyClassName="letter-frame-body"
            className="letter-frame"
          >
            <div
              className="letter-content"
              style={{
                padding: background
                  ? `${DEFAULT_HEADER_SPACE}px ${DEFAULT_SIDE_SPACE}px ${DEFAULT_FOOTER_SPACE}px`
                  : "48px",
              }}
            >
              {index > 0 && (
                <header className="letter-continuation">
                  <span>
                    {form.show_reference === false
                      ? "Continued"
                      : `${form.number || "Letter"} · continued`}
                  </span>
                </header>
              )}
              {page.parts.map((part) => (
                <div
                  key={part.id}
                  data-letter-source={part.sourceId}
                  data-letter-kind={part.kind}
                  className={`letter-part letter-${part.kind}`}
                  role={
                    part.kind === "title" && part.id === "title-0" ? "heading" : undefined
                  }
                  aria-level={
                    part.kind === "title" && part.id === "title-0" ? 1 : undefined
                  }
                  aria-label={
                    part.kind === "title" && part.id === "title-0"
                      ? form.title || "Letter"
                      : undefined
                  }
                  style={{
                    height: part.height,
                    marginTop: part.gap,
                    textAlign: part.align,
                    fontSize: part.size,
                    lineHeight: `${part.lineHeight}px`,
                    fontWeight: part.weight,
                    fontFamily: part.font,
                    fontStyle: part.italic ? "italic" : undefined,
                    textDecoration: part.underline ? "underline" : undefined,
                    color: part.color,
                  }}
                  dir="auto"
                >
                  {part.kind === "signature" || part.kind === "stamp" ? (
                    <Mark part={part} />
                  ) : part.kind === "logo" ? (
                    <CompanyAssetImage
                      src={form.company_logo}
                      alt={`${form.company_name || "Company"} logo`}
                      style={{
                        width: part.width,
                        height: 60,
                        objectFit: "contain",
                        display: "inline-block",
                      }}
                    />
                  ) : (
                    part.text.replace(/\r?\n$/, "")
                  )}
                </div>
              ))}
            </div>
          </LetterheadFrame>
          <footer
            className="letter-footer"
            style={{
              left: background ? DEFAULT_SIDE_SPACE : 48,
              right: background ? DEFAULT_SIDE_SPACE : 48,
              bottom: background ? DEFAULT_FOOTER_SPACE + 12 : 48,
            }}
          >
            {form.show_reference !== false && <span>{form.number || "Letter"}</span>}
            <span>
              Page {index + 1} of {pages.length}
            </span>
          </footer>
        </div>
      ))}
    </>
  );
  return documentRef ? (
    <div ref={documentRef} style={{ width: A4_W }}>
      {sheets}
    </div>
  ) : (
    sheets
  );
}
