import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Extension,
  Node as EditorNode,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Plugin } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  letterRichDocument,
  LETTER_RICH_FONTS,
  validateLetterRichDocument,
  type LetterRichDocument,
} from "../lib/letterRichText";
import type { LetterForm } from "../lib/letters";
import { fmtDate } from "../lib/format";
import { CompanyAssetImage } from "./CompanyAssetImage";
import { SelectMenu } from "./ui-menu";
import "./LetterWordEditor.css";

const FormContext = createContext<LetterForm | null>(null);
const validNumber = (raw: string, min: number, max: number) => {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
};
const fontSize = (raw: string) => {
  const match = /^(\d+(?:\.\d+)?)(pt|px)$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]) * (match[2].toLowerCase() === "px" ? 0.75 : 1);
  return value >= 8 && value <= 36 ? `${Math.round(value * 100) / 100}pt` : null;
};
const fontFamily = (raw: string) =>
  LETTER_RICH_FONTS.find(
    (font) =>
      raw.split(",")[0].trim().replace(/["']/g, "").toLowerCase() === font.toLowerCase()
  ) ?? null;
const textColor = (raw: string) => {
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  const match = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(raw);
  return match && match.slice(1).every((value) => Number(value) <= 255)
    ? `#${match
        .slice(1)
        .map((value) => Number(value).toString(16).padStart(2, "0"))
        .join("")}`
    : null;
};

// The saved document is a small, validated JSON schema. Paste never stores HTML,
// URLs or external images; unsupported styles are discarded by the schema.
const LetterTypography = Extension.create({
  name: "letterTypography",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => fontFamily(element.style.fontFamily),
            renderHTML: (attrs) =>
              attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {},
          },
          fontSize: {
            default: null,
            parseHTML: (element) => fontSize(element.style.fontSize),
            renderHTML: (attrs) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
          color: {
            default: null,
            parseHTML: (element) => textColor(element.style.color),
            renderHTML: (attrs) =>
              attrs.color ? { style: `color: ${attrs.color}` } : {},
          },
        },
      },
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) => validNumber(element.style.lineHeight, 1, 2.5),
            renderHTML: (attrs) =>
              attrs.lineSpacing != null
                ? { style: `line-height: ${attrs.lineSpacing}` }
                : {},
          },
          paragraphSpacing: {
            default: null,
            parseHTML: (element) =>
              /^\d+(?:\.\d+)?px$/.test(element.style.marginBottom)
                ? validNumber(element.style.marginBottom.slice(0, -2), 0, 32)
                : null,
            renderHTML: (attrs) =>
              attrs.paragraphSpacing != null
                ? { style: `margin-bottom: ${attrs.paragraphSpacing}px` }
                : {},
          },
        },
      },
    ];
  },
});

function CompanyMark({ node }: NodeViewProps) {
  const form = useContext(FormContext);
  const signature = node.type.name === "companySignature";
  const asset = signature ? form?.signature : form?.stamp;
  const enabled = signature ? form?.show_signature : form?.show_stamp;
  return (
    <NodeViewWrapper
      className="letter-word-mark"
      contentEditable={false}
      style={{ textAlign: node.attrs.textAlign || "left" }}
    >
      {node.attrs.label && <p>{String(node.attrs.label)}</p>}
      {enabled && asset?.data ? (
        <MarkImage form={form!} signature={signature} />
      ) : (
        <span className="letter-word-mark-placeholder">
          {signature ? "Signature" : "Company stamp"}
        </span>
      )}
    </NodeViewWrapper>
  );
}
function MarkImage({ form, signature }: { form: LetterForm; signature: boolean }) {
  const asset = signature ? form.signature : form.stamp;
  if (!asset?.data) return null;
  const width = Math.min(682, ((signature ? 180 : 110) * (asset.scale ?? 100)) / 100);
  return (
    <CompanyAssetImage
      src={asset.data}
      alt={signature ? "Company signature" : "Company stamp"}
      style={{
        width,
        height: Math.min(360, width * (signature ? 0.5 : 1)),
        maxWidth: "100%",
        opacity: (asset.opacity ?? 100) / 100,
        mixBlendMode: "multiply",
        clipPath: `inset(${asset.cropTop ?? 0}% ${asset.cropRight ?? 0}% ${asset.cropBottom ?? 0}% ${asset.cropLeft ?? 0}%)`,
      }}
    />
  );
}
function markNode(name: "companySignature" | "companyStamp") {
  return EditorNode.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return { label: { default: "" }, textAlign: { default: "left" } };
    },
    parseHTML() {
      return [];
    }, // Saved company marks can only be inserted explicitly.
    renderHTML({ node }) {
      return [
        "div",
        { "data-company-mark": name },
        String(
          node.attrs.label ||
            (name === "companySignature" ? "Signature" : "Company stamp")
        ),
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer(CompanyMark);
    },
  });
}

/** Remove editor-only, empty defaults without widening the persisted schema. */
function letterEditorDocument(json: JSONContent): LetterRichDocument {
  const copy = structuredClone(json);
  const walk = (node: JSONContent) => {
    if (node.type === "orderedList" && node.attrs?.type == null && node.attrs)
      delete node.attrs.type;
    if (node.type === "hardBreak") {
      delete node.marks;
      delete node.attrs;
    }
    node.content?.forEach(walk);
  };
  walk(copy);
  validateLetterRichDocument(copy);
  return copy;
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const parsed = validNumber(draft, min, max);
    if (parsed == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onCommit(Math.round(parsed * 100) / 100);
  };
  return (
    <label className="letter-word-number" title={`${label}: ${min}–${max}${unit}`}>
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setDraft(String(value));
            setInvalid(false);
          }
        }}
      />
      <span aria-hidden="true">{unit}</span>
      {invalid && (
        <span role="alert" className="letter-word-number-error">
          Enter {min}–{max}
          {unit}.
        </span>
      )}
    </label>
  );
}
function ToolButton({
  label,
  active,
  disabled,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="letter-word-tool"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function WordToolbar({
  editor,
  form,
  disabled,
}: {
  editor: Editor | null;
  form: LetterForm;
  disabled: boolean;
}) {
  const [moreTools, setMoreTools] = useState(false);
  const restoreCanvas = useRef(false);
  const restoreSelection = (event: Event) => {
    if (!restoreCanvas.current) return;
    restoreCanvas.current = false;
    event.preventDefault();
    editor?.commands.focus(undefined, { scrollIntoView: false });
  };
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            heading: current.isActive("heading")
              ? String(current.getAttributes("heading").level)
              : "paragraph",
            style: current.getAttributes("textStyle"),
            paragraph: current.getAttributes(
              current.isActive("heading") ? "heading" : "paragraph"
            ),
            undo: current.can().undo(),
            redo: current.can().redo(),
          }
        : null,
  });
  const unavailable = disabled || !editor;
  const paragraph = (attrs: Record<string, unknown>) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", attrs)
      .updateAttributes("heading", attrs)
      .run();
  };
  const insert = (value: string) => {
    if (!editor || !value) return;
    if (value === "date")
      editor.chain().focus().insertContent(fmtDate(form.issue_date)).run();
    else if (value === "signature" || value === "stamp")
      editor
        .chain()
        .focus()
        .insertContent({
          type: value === "signature" ? "companySignature" : "companyStamp",
          attrs: { label: "", textAlign: "left" },
        })
        .run();
    else if (value === "authorization")
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Authorization letter" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "To whom it may concern," }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "We authorize [employee name] to act on behalf of [company name] for [responsibilities].",
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Employee email: [email address]" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Mobile number: [mobile number]" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Yours sincerely," }] },
        ])
        .run();
  };
  const font = String(
    state?.style.fontFamily ||
      (form.text_style?.font === "classic"
        ? "Lora"
        : form.text_style?.font === "mono"
          ? "IBM Plex Mono"
          : "Inter")
  );
  const headingSize =
    state?.heading === "1"
      ? 24
      : state?.heading === "2"
        ? 20
        : state?.heading === "3"
          ? 16
          : form.text_style?.fontSize || 11;
  const size = Number.parseFloat(state?.style.fontSize || String(headingSize));
  return (
    <div
      className={`letter-word-ribbon${moreTools ? " letter-word-ribbon-expanded" : ""}`}
      aria-label="Letter editing tools"
    >
      <div className="letter-word-ribbon-row" role="group" aria-label="Text tools">
        <div className="letter-word-group letter-word-history">
          <ToolButton
            label="Undo"
            disabled={unavailable || !state?.undo}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton
            label="Redo"
            disabled={unavailable || !state?.redo}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </ToolButton>
        </div>
        <div className="letter-word-group letter-word-font">
          <SelectMenu
            ariaLabel="Text style"
            onCloseAutoFocus={restoreSelection}
            value={state?.heading || "paragraph"}
            disabled={unavailable}
            options={[
              { value: "paragraph", label: "Normal" },
              { value: "1", label: "Title" },
              { value: "2", label: "Heading" },
              { value: "3", label: "Subheading" },
            ]}
            onChange={(value) => {
              restoreCanvas.current = true;
              if (value === "paragraph") editor?.chain().focus().setParagraph().run();
              else
                editor
                  ?.chain()
                  .focus()
                  .setHeading({ level: Number(value) as 1 | 2 | 3 })
                  .run();
            }}
          />
          <SelectMenu
            ariaLabel="Font"
            onCloseAutoFocus={restoreSelection}
            value={font}
            disabled={unavailable}
            options={LETTER_RICH_FONTS.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              restoreCanvas.current = true;
              editor?.chain().focus().setMark("textStyle", { fontFamily: value }).run();
            }}
          />
          <NumberControl
            label="Font size"
            value={size}
            min={8}
            max={36}
            step={0.5}
            unit="pt"
            disabled={unavailable}
            onCommit={(value) =>
              editor
                ?.chain()
                .focus()
                .setMark("textStyle", { fontSize: `${value}pt` })
                .run()
            }
          />
        </div>
        <div className="letter-word-group letter-word-emphasis">
          <ToolButton
            label="Bold"
            active={state?.bold}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={16} />
          </ToolButton>
          <ToolButton
            label="Italic"
            active={state?.italic}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} />
          </ToolButton>
          <ToolButton
            label="Underline"
            active={state?.underline}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <Underline size={16} />
          </ToolButton>
          <label className="letter-word-color" title="Text color">
            <span className="sr-only">Text color</span>
            <input
              type="color"
              aria-label="Text color"
              value={state?.style.color || form.text_style?.color || "#222222"}
              disabled={unavailable}
              onChange={(event) =>
                editor
                  ?.chain()
                  .focus()
                  .setMark("textStyle", { color: event.target.value })
                  .run()
              }
            />
          </label>
        </div>
      </div>
      <div
        className="letter-word-ribbon-row"
        role="group"
        aria-label="Paragraph and insert tools"
      >
        <div className="letter-word-group letter-word-alignment">
          {(
            [
              { value: "left", label: "Align left", icon: AlignLeft },
              { value: "center", label: "Align center", icon: AlignCenter },
              { value: "right", label: "Align right", icon: AlignRight },
              { value: "justify", label: "Justify", icon: AlignJustify },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <ToolButton
              key={value}
              label={label}
              active={(state?.paragraph.textAlign || "left") === value}
              disabled={unavailable}
              onClick={() => editor?.chain().focus().setTextAlign(value).run()}
            >
              <Icon size={16} />
            </ToolButton>
          ))}
        </div>
        <div className="letter-word-group letter-word-lists">
          <ToolButton
            label="Bullet list"
            active={state?.bullet}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={state?.ordered}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </ToolButton>
          <ToolButton
            label="Quote"
            active={state?.quote}
            disabled={unavailable}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={16} />
          </ToolButton>
        </div>
        <div className="letter-word-group letter-word-spacing">
          <span className="letter-word-control-label">Line</span>
          <NumberControl
            label="Line spacing"
            value={state?.paragraph.lineSpacing ?? form.text_style?.lineSpacing ?? 1.5}
            min={1}
            max={2.5}
            step={0.05}
            unit="×"
            disabled={unavailable}
            onCommit={(value) => paragraph({ lineSpacing: value })}
          />
          <span className="letter-word-control-label">After</span>
          <NumberControl
            label="Paragraph spacing"
            value={
              state?.paragraph.paragraphSpacing ?? form.text_style?.paragraphSpacing ?? 16
            }
            min={0}
            max={32}
            step={1}
            unit="px"
            disabled={unavailable}
            onCommit={(value) => paragraph({ paragraphSpacing: value })}
          />
        </div>
        <div className="letter-word-insert">
          <SelectMenu
            ariaLabel="Insert into letter"
            onCloseAutoFocus={restoreSelection}
            value=""
            disabled={unavailable}
            options={[
              { value: "", label: "Insert…" },
              { value: "date", label: "Issue date" },
              { value: "authorization", label: "Authorization wording" },
              { value: "signature", label: "Company signature" },
              { value: "stamp", label: "Company stamp" },
            ]}
            onChange={(value) => {
              restoreCanvas.current = true;
              insert(value);
            }}
          />
        </div>
      </div>
      <button
        type="button"
        className="letter-word-more"
        aria-expanded={moreTools}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setMoreTools(!moreTools)}
      >
        {moreTools ? "Fewer tools" : "More tools"}
      </button>
    </div>
  );
}

export function LetterWordEditor(props: {
  form: LetterForm;
  disabled?: boolean;
  onChange: (document: LetterRichDocument) => void;
}) {
  try {
    letterRichDocument(props.form);
  } catch {
    return (
      <p role="alert" className="rounded-xl border border-border bg-card p-5 text-sm">
        This saved letter is too large or has unsupported formatting for the canvas. Its
        original content is preserved. Use Preview or PDF to view it.
      </p>
    );
  }
  return <WordCanvas {...props} />;
}
function WordCanvas({
  form,
  disabled = false,
  onChange,
}: {
  form: LetterForm;
  disabled?: boolean;
  onChange: (document: LetterRichDocument) => void;
}) {
  const latest = useRef({ form, onChange });
  latest.current = { form, onChange };
  const initial = useRef<LetterRichDocument | null>(null);
  if (!initial.current) initial.current = letterRichDocument(form);
  const accepted = useRef(JSON.stringify(initial.current));
  const [error, setError] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
      }),
      TextStyle,
      LetterTypography,
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      markNode("companySignature"),
      markNode("companyStamp"),
      Extension.create({
        name: "letterDocumentLimits",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(transaction) {
                if (!transaction.docChanged) return true;
                try {
                  letterEditorDocument(transaction.doc.toJSON());
                  return true;
                } catch {
                  queueMicrotask(() =>
                    setError(
                      "This edit exceeds the letter limits or uses unsupported formatting. Your previous content is unchanged."
                    )
                  );
                  return false;
                }
              },
            }),
          ];
        },
      }),
    ],
    content: initial.current as JSONContent,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Letter canvas",
        "aria-multiline": "true",
        "data-placeholder": "Start typing your letter…",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      const document = letterEditorDocument(current.getJSON());
      accepted.current = JSON.stringify(document);
      setError("");
      latest.current.onChange(document);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
    editor?.setOptions({
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Letter canvas",
          "aria-multiline": "true",
          "aria-readonly": String(disabled),
          "data-placeholder": "Start typing your letter…",
          spellcheck: "true",
        },
      },
    });
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor) return;
    // Legacy metadata still supplies printable prose until the first canvas
    // edit. Keep it in sync without rewriting the saved letter on mount.
    const document = form.rich_document ?? letterRichDocument(form);
    const incoming = JSON.stringify(document);
    if (incoming !== accepted.current) {
      validateLetterRichDocument(document);
      accepted.current = incoming;
      editor.commands.setContent(document as JSONContent, {
        emitUpdate: false,
      });
    }
  }, [editor, form]);
  const text =
    useEditorState({
      editor,
      selector: ({ editor: current }) => current?.getText() || "",
    }) || "";
  const count = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const hasHeader =
    form.show_company_header ?? !(form.use_letterhead && form.letterhead?.background);
  const hasLetterhead = form.use_letterhead && !!form.letterhead?.background;
  const paperStyle = {
    "--letter-font":
      form.text_style?.font === "classic"
        ? "Lora, Georgia, serif"
        : form.text_style?.font === "mono"
          ? "'IBM Plex Mono', monospace"
          : "Inter, Arial, sans-serif",
    "--letter-size": `${form.text_style?.fontSize || 11}pt`,
    "--letter-line": form.text_style?.lineSpacing || 1.5,
    "--letter-after": `${form.text_style?.paragraphSpacing ?? 16}px`,
    "--letter-ink": form.text_style?.color || "#222222",
  } as CSSProperties;
  return (
    <FormContext.Provider value={form}>
      <div className="letter-word-editor">
        <WordToolbar editor={editor} form={form} disabled={disabled} />
        {error && (
          <p
            role="alert"
            className="border-b border-border px-4 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="letter-word-stage">
          <div
            className={`letter-word-paper ${hasLetterhead ? "letter-word-paper-letterhead" : ""} ${form.template === "letter-formal" ? "letter-word-paper-formal" : ""}`}
            style={paperStyle}
          >
            {hasLetterhead && (
              <CompanyAssetImage
                src={form.letterhead?.background}
                alt="Company letterhead"
                className="letter-word-letterhead"
              />
            )}
            {((hasHeader && (form.company_name || form.company_address)) ||
              (form.show_logo && form.company_logo)) && (
              <header className="letter-word-company" contentEditable={false}>
                {form.show_logo && form.company_logo && (
                  <CompanyAssetImage
                    src={form.company_logo}
                    alt="Company logo"
                    className="letter-word-logo"
                  />
                )}
                {hasHeader && (
                  <div>
                    <strong>{form.company_name}</strong>
                    {form.company_address && <p>{form.company_address}</p>}
                    <p>
                      {[form.company_email, form.company_phone]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {form.company_trn && <p>TRN {form.company_trn}</p>}
                  </div>
                )}
              </header>
            )}
            <div className="letter-word-reference" contentEditable={false}>
              {form.show_reference !== false && <span>{form.number}</span>}
              <span>{fmtDate(form.issue_date)}</span>
            </div>
            <EditorContent editor={editor} />
            {(["signature", "stamp"] as const).map((kind) => {
              const asset = form[kind],
                enabled = kind === "signature" ? form.show_signature : form.show_stamp;
              const name = kind === "signature" ? "companySignature" : "companyStamp";
              const contains = (nodes: JSONContent[]): boolean =>
                nodes.some((node) => node.type === name || contains(node.content || []));
              return enabled &&
                asset?.data &&
                !contains(editor?.getJSON().content || []) ? (
                <div className="letter-word-mark" key={kind}>
                  <MarkImage form={form} signature={kind === "signature"} />
                </div>
              ) : null;
            })}
          </div>
        </div>
        <div className="letter-word-status">
          <span>
            {count} {count === 1 ? "word" : "words"}
          </span>
          <span>{disabled ? "Read only" : "A4 · PDF preview shows page breaks"}</span>
        </div>
      </div>
    </FormContext.Provider>
  );
}
