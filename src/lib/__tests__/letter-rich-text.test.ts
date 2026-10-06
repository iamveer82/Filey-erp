import { expect, it } from "vitest";
import type { LetterForm } from "../letters";
import { fmtDate } from "../format";
import {
  letterRichDocument,
  letterRichDocumentToLegacy,
  letterRichText,
  validateLetterRichDocument,
  type LetterRichDocument,
  type LetterRichNode,
} from "../letterRichText";

const document = (
  content: LetterRichNode[] = [{ type: "paragraph" }]
): LetterRichDocument => ({ type: "doc", content });
const paragraph = (text = "Letter text"): LetterRichNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const legacy = (extra: Partial<LetterForm> = {}): LetterForm =>
  ({
    title: "",
    recipient_name: "",
    recipient_address: "",
    salutation: "",
    body: "",
    closing: "",
    signatory_name: "",
    signatory_title: "",
    text_style: { font: "modern", fontSize: 11, lineSpacing: 1.5, paragraphSpacing: 16 },
    blocks: [],
    show_signature: false,
    show_stamp: false,
    ...extra,
  }) as LetterForm;

it("accepts the bounded editor schema and extracts searchable prose without markup or company assets", () => {
  const value = document([
    {
      type: "heading",
      attrs: { level: 2, textAlign: "center" },
      content: [{ type: "text", text: "Subject", marks: [{ type: "bold" }] }],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "justify", lineSpacing: 1.4, paragraphSpacing: 6 },
      content: [
        {
          type: "text",
          text: "A <script> is plain text.",
          marks: [
            { type: "italic" },
            { type: "underline" },
            {
              type: "textStyle",
              attrs: { fontFamily: "Georgia", fontSize: "12.5pt", color: "#aAbBcC" },
            },
          ],
        },
        { type: "hardBreak" },
        { type: "text", text: "Second line" },
      ],
    },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("First item")] }],
    },
    {
      type: "orderedList",
      attrs: { start: 2 },
      content: [{ type: "listItem", content: [paragraph("Second item")] }],
    },
    { type: "blockquote", content: [paragraph("Quoted wording")] },
    {
      type: "companySignature",
      attrs: { label: "Authorized signature", textAlign: "right" },
    },
    { type: "companyStamp", attrs: { label: "Company stamp", textAlign: "left" } },
  ]);
  expect(() => validateLetterRichDocument(value)).not.toThrow();
  expect(letterRichText(value)).toBe(
    "Subject\nA <script> is plain text.\nSecond line\n• First item\n2. Second item\nQuoted wording\n\n"
  );
  expect(letterRichText(value)).not.toContain("Authorized signature");
});

it.each([
  null,
  [],
  {},
  { type: "doc", content: [] },
  { ...document(), html: "<div>" },
  document([
    {
      type: "image",
      attrs: { src: "https://example.test/tracker" },
    } as unknown as LetterRichNode,
  ]),
  document([
    {
      type: "paragraph",
      attrs: { style: "background:url(https://tracker.test)" },
    } as unknown as LetterRichNode,
  ]),
  document([
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "x",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    } as unknown as LetterRichNode,
  ]),
  document([{ type: "paragraph", content: [{ type: "paragraph" }] }]),
  document([{ type: "text", text: "top-level text" }]),
  document([{ type: "bulletList", content: [paragraph()] }]),
  document([{ type: "listItem", content: [paragraph()] }]),
  document([
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "heading", attrs: { level: 1 } }] },
      ],
    },
  ]),
  document([{ type: "heading", attrs: { level: 4 } } as unknown as LetterRichNode]),
  document([
    {
      type: "companyStamp",
      attrs: { label: "Stamp", data: "private-asset" },
    } as unknown as LetterRichNode,
  ]),
  document([{ type: "companySignature", attrs: { label: "a\nb" } }]),
  document([{ type: "companySignature" }]),
  document([{ type: "hardBreak" }]),
  document([
    {
      type: "orderedList",
      attrs: { start: 0 },
      content: [{ type: "listItem", content: [paragraph()] }],
    },
  ]),
])("rejects unsafe or structurally invalid rich document %#", (value) => {
  expect(() => validateLetterRichDocument(value)).toThrow("Letter document");
});

it.each([
  { fontFamily: "Inter; background:url(tracker)" },
  { fontFamily: "Unknown Font" },
  { fontSize: "37pt" },
  { fontSize: "7pt" },
  { fontSize: "12px" },
  { fontSize: "12pt;display:none" },
  { color: "red" },
  { color: "#fff" },
  { color: "var(--external)" },
  { opacity: 0.5 },
])("rejects arbitrary CSS in textStyle %#", (attrs) => {
  expect(() =>
    validateLetterRichDocument(
      document([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "text",
              marks: [{ type: "textStyle", attrs } as never],
            },
          ],
        },
      ])
    )
  ).toThrow();
});

it("permits null editor defaults but rejects duplicate marks, unknown block attrs and out-of-range spacing", () => {
  expect(() =>
    validateLetterRichDocument(
      document([
        {
          type: "paragraph",
          attrs: { textAlign: null, lineSpacing: null, paragraphSpacing: null },
          content: [
            {
              type: "text",
              text: "text",
              marks: [
                {
                  type: "textStyle",
                  attrs: { fontFamily: null, fontSize: null, color: null },
                },
              ],
            },
          ],
        },
      ])
    )
  ).not.toThrow();
  for (const attrs of [
    { lineSpacing: Infinity },
    { lineSpacing: 0.9 },
    { paragraphSpacing: 33 },
    { indent: 1 },
  ])
    expect(() =>
      validateLetterRichDocument(document([{ type: "paragraph", attrs } as never]))
    ).toThrow();
  expect(() =>
    validateLetterRichDocument(
      document([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] },
          ],
        },
      ])
    )
  ).toThrow();
});

it("bounds malicious nesting, cycles, node counts, text and serialized formatting size before persistence", () => {
  const cycle: LetterRichNode = { type: "blockquote" };
  cycle.content = [cycle];
  expect(() => validateLetterRichDocument(document([cycle]))).toThrow();
  let deep = paragraph();
  for (let index = 0; index < 17; index++) deep = { type: "blockquote", content: [deep] };
  expect(() => validateLetterRichDocument(document([deep]))).toThrow();
  expect(() =>
    validateLetterRichDocument(
      document(Array.from({ length: 20_001 }, () => ({ type: "paragraph" })))
    )
  ).toThrow();
  expect(() =>
    validateLetterRichDocument(document([paragraph("x".repeat(250_001))]))
  ).toThrow();
  const formatted = Array.from({ length: 19_000 }, () => ({
    type: "text" as const,
    text: "x",
    marks: [
      { type: "bold" as const },
      { type: "italic" as const },
      { type: "underline" as const },
      {
        type: "textStyle" as const,
        attrs: {
          fontFamily: "IBM Plex Mono" as const,
          fontSize: "12.5pt",
          color: "#abcdef",
        },
      },
    ],
  }));
  expect(() =>
    validateLetterRichDocument(document([{ type: "paragraph", content: formatted }]))
  ).toThrow();
});

it("migrates every legacy prose slot and company sign-off in order, retaining inline emphasis and alignment", () => {
  const form = legacy({
    title: "Authorization",
    recipient_name: "Recipient",
    recipient_address: "Address",
    salutation: "Dear recipient,",
    body: "Intro\nSecond line",
    closing: "Sincerely,",
    signatory_name: "Signer",
    signatory_title: "Director",
    text_style: {
      font: "classic",
      fontSize: 12.5,
      bold: true,
      italic: true,
      underline: true,
      color: "#112233",
      lineSpacing: 1.4,
      paragraphSpacing: 6,
    },
    title_style: { fontSize: 20, align: "center" },
    show_signature: true,
    show_stamp: true,
    blocks: [
      {
        id: "field",
        type: "field",
        label: "Email",
        value: "test@example.test",
        align: "right",
        style: { bold: false },
      },
      { id: "sig", type: "signature", label: "Sign here", align: "left" },
      { id: "body", type: "text", text: "Last content", align: "center" },
    ],
  });
  const value = letterRichDocument(form);
  expect(letterRichText(value)).toBe(
    "Recipient\nAddress\nAuthorization\nDear recipient,\nIntro\nSecond line\nEmail: test@example.test\n\nLast content\nSincerely,\nSigner\nDirector\n"
  );
  expect(value.content[4].content?.[0].marks).toEqual([
    { type: "bold" },
    { type: "italic" },
    { type: "underline" },
    {
      type: "textStyle",
      attrs: { fontFamily: "Lora", fontSize: "12.5pt", color: "#112233" },
    },
  ]);
  expect(value.content[5].attrs?.textAlign).toBe("right");
  expect(value.content[5].content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(
    false
  );
  expect(value.content.filter((node) => node.type === "companySignature")).toHaveLength(
    1
  );
  expect(value.content[value.content.length - 1]).toEqual({
    type: "companyStamp",
    attrs: { label: "", textAlign: "left" },
  });
  expect(form.body).toBe("Intro\nSecond line");
});

it("clones an existing rich document without mutating its issued snapshot or falling back to stale legacy prose", () => {
  const rich = document([paragraph("Canvas contents")]);
  const form = legacy({ body: "Stale legacy value", rich_document: rich });
  const copy = letterRichDocument(form);
  copy.content[0].content![0].text = "Edited canvas";
  expect(rich.content[0].content![0].text).toBe("Canvas contents");
  expect(letterRichText(letterRichDocument(form))).toBe("Canvas contents");
});

it("projects long rich prose for legacy readers without silently truncating it", () => {
  const text = "a".repeat(120_000),
    value = document([paragraph(text)]);
  const projection = letterRichDocumentToLegacy(value);
  expect(projection.body).toHaveLength(50_000);
  expect(
    projection.blocks.every(
      (block) => block.type === "text" && block.text.length <= 20_000
    )
  ).toBe(true);
  expect(
    projection.body +
      projection.blocks.map((block) => (block.type === "text" ? block.text : "")).join("")
  ).toBe(text);
  expect(projection.blocks.map((block) => block.id)).toEqual([
    "rich-text-1",
    "rich-text-2",
    "rich-text-3",
    "rich-text-4",
  ]);
});

it("does not duplicate a migrated title and retains company mark slots in its legacy projection", () => {
  const rich = letterRichDocument(
    legacy({
      title: "Authorization",
      body: "Authorization\nFull existing canvas",
      show_signature: true,
    })
  );
  expect(letterRichText(rich).split("Authorization")).toHaveLength(2);
  expect(letterRichDocumentToLegacy(rich).blocks).toEqual([
    { id: "rich-signoff-1", type: "signature", label: "", align: "left" },
  ]);
});

it("preserves legacy date wording and places the global signature before the signatory", () => {
  const rich = letterRichDocument(
    legacy({
      closing: "Sincerely,",
      signatory_name: "Signer",
      signatory_title: "Director",
      show_signature: true,
      blocks: [
        { id: "date", type: "date", label: "Date", value: "2026-10-03", align: "left" },
      ],
    })
  );
  expect(letterRichText(rich)).toContain(`Date: ${fmtDate("2026-10-03")}`);
  expect(rich.content.map((node) => node.type)).toEqual([
    "paragraph",
    "paragraph",
    "companySignature",
    "paragraph",
    "paragraph",
  ]);
  expect(rich.content[3].content?.[0].text).toBe("Signer");
});

it("projects Unicode without splitting surrogate pairs and rejects values PostgreSQL JSON cannot retain", () => {
  const value = "a".repeat(49_999) + "😀" + "b".repeat(19_999) + "😄" + "suffix";
  const projection = letterRichDocumentToLegacy(document([paragraph(value)]));
  expect(projection.body).toHaveLength(49_999);
  expect(
    projection.body +
      projection.blocks.map((block) => (block.type === "text" ? block.text : "")).join("")
  ).toBe(value);
  expect(
    projection.blocks.every(
      (block) => block.type !== "text" || !/[\uD800-\uDBFF]$/.test(block.text)
    )
  ).toBe(true);
  for (const text of ["a\u0000b", "a\ud800b", "a\udc00b"])
    expect(() => validateLetterRichDocument(document([paragraph(text)]))).toThrow();
});

it("accepts exactly 89 company marks and rejects the 90th even across nested containers", () => {
  const marks = (count: number): LetterRichNode[] =>
    Array.from({ length: count }, (_, index) => ({
      type: index % 2 ? "companySignature" : "companyStamp",
      attrs: { label: "", textAlign: "left" },
    }));
  expect(() =>
    validateLetterRichDocument(document([paragraph(), ...marks(89)]))
  ).not.toThrow();
  expect(() => validateLetterRichDocument(document([paragraph(), ...marks(90)]))).toThrow(
    "Letter document"
  );
  expect(() =>
    validateLetterRichDocument(
      document([paragraph(), ...marks(45), { type: "blockquote", content: marks(45) }])
    )
  ).toThrow("Letter document");
});
