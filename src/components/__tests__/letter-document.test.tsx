import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blankLetterForm, type LetterForm } from "../../lib/letters";
import {
  letterRichDocument,
  validateLetterRichDocument,
  type LetterRichDocument,
  type LetterRichNode,
} from "../../lib/letterRichText";
import { SIGN_DEFAULT, STAMP_DEFAULT } from "../StampSignature";
import LetterDocument, { LETTER_TEMPLATES, paginateLetter } from "../LetterDocument";

const image = "data:image/png;base64,aGVsbG8=";
function example(): LetterForm {
  return {
    ...blankLetterForm("LTR-2026-014"),
    title: "Employment confirmation",
    company_name: "Northline Trading",
    company_address: "21 Market Road\nDubai, UAE",
    company_trn: "100123456789012",
    company_email: "hello@example.test",
    recipient_name: "Alex Morgan",
    recipient_address: "Harbour Works\nDubai",
    salutation: "Dear Alex,",
    body: "We confirm your appointment.",
    signatory_name: "Jamie Smith",
    signatory_title: "Operations Manager",
    blocks: [
      {
        id: "position",
        type: "field",
        label: "Position",
        value: "Sales Manager",
        align: "left",
      },
      {
        id: "start",
        type: "date",
        label: "Effective date",
        value: "2026-10-03",
        align: "right",
      },
    ],
  };
}
function documentFor(
  form: LetterForm,
  companyStampSig?: Parameters<typeof LetterDocument>[0]["companyStampSig"],
  pageIndex?: number
) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <LetterDocument form={form} companyStampSig={companyStampSig} pageIndex={pageIndex} />
  );
  return host;
}

describe("LetterDocument", () => {
  it("prints the continuous rich canvas once in each template, preserving the surrounding company frame", () => {
    const form = example();
    form.rich_document = letterRichDocument(form);
    // Prose in the document is authoritative; these compatibility fields must not duplicate it.
    form.title = "Outdated title";
    form.body = "Outdated body";
    form.recipient_name = "Outdated recipient";
    form.closing = "Outdated closing";
    for (const template of LETTER_TEMPLATES) {
      const host = documentFor({ ...form, template: template.id });
      for (const prose of [
        "Employment confirmation",
        "Alex Morgan",
        "We confirm your appointment.",
        "Yours sincerely,",
      ])
        expect(host.textContent!.split(prose)).toHaveLength(2);
      expect(host.textContent).not.toContain("Outdated");
      expect(host.textContent).toContain("Northline Trading");
      expect(host.textContent).toContain("Date:");
      expect(host.firstElementChild!.getAttribute("data-letter-template")).toBe(
        template.id
      );
      expect(host.querySelectorAll(".letter-rich-line").length).toBeGreaterThan(5);
      expect(host.querySelectorAll("[data-letter-source=title]")).toHaveLength(0);
    }
  });

  it("keeps selection marks and mixed font sizes in the exported DOM and measures the tallest run", () => {
    const rich: LetterRichDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "right", lineSpacing: 1.75, paragraphSpacing: 7.5 },
          content: [
            { type: "text", text: "Plain ", marks: [] },
            {
              type: "text",
              text: "Important",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "underline" },
                {
                  type: "textStyle",
                  attrs: { fontFamily: "Georgia", fontSize: "18pt", color: "#234567" },
                },
              ],
            },
          ],
        },
      ],
    };
    const form = {
      ...example(),
      rich_document: rich,
      text_style: { fontSize: 11, bold: true, italic: true, underline: true },
    };
    const part = paginateLetter(form)
      .flatMap((page) => page.parts)
      .find((part) => part.runs)!;
    expect(part.text).toBe("Plain Important");
    expect(part.lineHeight).toBe(42);
    expect(part.height).toBe(42);
    expect(part.gap).toBe(22);
    expect(part.align).toBe("right");
    expect(part.runs![0]).toEqual(expect.objectContaining({ weight: 400 }));
    expect(part.runs![0].italic).toBeUndefined();
    expect(part.runs![0].underline).toBeUndefined();
    const host = documentFor(form);
    const selected = Array.from(
      host.querySelectorAll<HTMLSpanElement>(".letter-rich-line span")
    ).find((span) => span.textContent === "Important")!;
    expect(selected.style.fontSize).toBe("24px");
    expect(selected.style.fontFamily).toBe("Georgia, serif");
    expect(selected.style.fontWeight).toBe("700");
    expect(selected.style.fontStyle).toBe("italic");
    expect(selected.style.textDecoration).toBe("underline");
    expect(selected.style.color).toBe("rgb(35, 69, 103)");
  });

  it("applies rich paragraph spacing after its own paragraph instead of before it", () => {
    const rich: LetterRichDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { paragraphSpacing: 32 },
          content: [{ type: "text", text: "First paragraph" }],
        },
        {
          type: "paragraph",
          attrs: { paragraphSpacing: 0 },
          content: [{ type: "text", text: "Second paragraph" }],
        },
        {
          type: "paragraph",
          attrs: { paragraphSpacing: 7.5 },
          content: [{ type: "text", text: "Third paragraph" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Fourth paragraph" }] },
      ],
    };
    const form = { ...example(), rich_document: rich };
    const parts = paginateLetter(form)
      .flatMap((page) => page.parts)
      .filter((part) => part.runs);
    expect(parts.map((part) => part.gap)).toEqual([22, 32, 0, 7.5]);
    const lines = documentFor(form).querySelectorAll<HTMLElement>(".letter-rich-line");
    expect(Array.from(lines, (line) => line.style.marginTop)).toEqual([
      "22px",
      "32px",
      "0px",
      "7.5px",
    ]);
  });

  it("uses a smaller selected paragraph font and keeps wide ordered markers inside the page", () => {
    const form = {
      ...example(),
      rich_document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { lineSpacing: 1 },
            content: [
              {
                type: "text",
                text: "Small note",
                marks: [{ type: "textStyle", attrs: { fontSize: "8pt" } }],
              },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 9999 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Large list item",
                        marks: [{ type: "textStyle", attrs: { fontSize: "36pt" } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as LetterRichDocument,
    };
    const parts = paginateLetter(form).flatMap((page) => page.parts);
    const note = parts.find((part) => part.text === "Small note")!;
    expect(note.size).toBeCloseTo((8 * 4) / 3);
    expect(note.lineHeight).toBeCloseTo(note.size);
    const numbered = parts.find((part) => part.marker === "9999.")!;
    expect(numbered.inset).toBeGreaterThan(100);
    expect(numbered.markerSize).toBe(48);
    for (const page of paginateLetter(form))
      expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
  });

  it("wraps long Unicode words at whole graphemes and justifies only continued visual lines", () => {
    const source = "👩🏽‍💻e\u0301".repeat(200);
    const form = {
      ...example(),
      rich_document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "justify" },
            content: [{ type: "text", text: source }],
          },
        ],
      } as LetterRichDocument,
    };
    const parts = paginateLetter(form)
      .flatMap((page) => page.parts)
      .filter((part) => part.runs);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.map((part) => part.text).join("")).toBe(source);
    for (const part of parts) {
      expect(part.text).not.toMatch(/^[\u0301\u200d]/u);
      expect(part.text).not.toMatch(/[\u200d]$/u);
    }
    expect(parts.slice(0, -1).every((part) => part.justifyLine)).toBe(true);
    expect(parts[parts.length - 1].justifyLine).toBe(false);
    const rendered = documentFor(form).querySelectorAll<HTMLElement>(".letter-rich-line");
    expect(rendered[0].style.textAlignLast).toBe("justify");
    expect(rendered[rendered.length - 1].style.textAlignLast).toBe("");
  });

  it("bounds deeply nested large-font list indentation without dropping valid document text", () => {
    let list: LetterRichNode | undefined;
    for (let level = 1; level <= 7; level++) {
      const content: LetterRichNode[] = [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `Nested level ${level}`,
              marks: [{ type: "textStyle", attrs: { fontSize: "36pt" } }],
            },
          ],
        },
      ];
      if (list) content.push(list);
      list = {
        type: "orderedList",
        attrs: { start: 9999 },
        content: [{ type: "listItem", content }],
      };
    }
    const rich: LetterRichDocument = { type: "doc", content: [list!] };
    validateLetterRichDocument(rich);
    const parts = paginateLetter({ ...example(), rich_document: rich })
      .flatMap((page) => page.parts)
      .filter((part) => part.runs);
    for (let level = 1; level <= 7; level++)
      expect(parts.map((part) => part.text).join("")).toContain(`Nested level ${level}`);
    for (const part of parts) expect(part.inset).toBeLessThanOrEqual(634);
  });

  it("renders ordered/nested lists, quotes and blank paragraphs with safe marks in their canvas order", () => {
    const rich: LetterRichDocument = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Authority" }],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Manage eDAS services" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Submit documents" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph" },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Within the assigned duties." }],
            },
          ],
        },
        {
          type: "companySignature",
          attrs: { label: "Authorized person", textAlign: "right" },
        },
        { type: "paragraph", content: [{ type: "text", text: "Company approval" }] },
        { type: "companyStamp", attrs: { label: "Company stamp" } },
      ],
    };
    const form = { ...example(), rich_document: rich };
    const parts = paginateLetter(form).flatMap((page) => page.parts);
    expect(parts.filter((part) => part.runs && !part.text)).toHaveLength(1);
    expect(parts.find((part) => part.marker === "3.")!.inset).toBe(28);
    expect(parts.find((part) => part.marker === "•")!.inset).toBe(56);
    expect(parts.find((part) => part.quote)!.inset).toBe(20);
    const host = documentFor(form);
    expect(host.querySelector('[role="heading"]')!.getAttribute("aria-level")).toBe("2");
    expect(
      Array.from(
        host.querySelectorAll(".letter-rich-marker"),
        (marker) => marker.textContent
      )
    ).toEqual(["3.", "•"]);
    expect(host.querySelectorAll(".letter-rich-quote")).toHaveLength(1);
    expect(host.querySelectorAll("[data-letter-manual-mark]")).toHaveLength(2);
    expect(host.textContent!.indexOf("Authorized person")).toBeLessThan(
      host.textContent!.indexOf("Company approval")
    );
    expect(host.textContent!.indexOf("Company approval")).toBeLessThan(
      host.textContent!.indexOf("Company stamp")
    );
    expect(host.querySelectorAll("img,script")).toHaveLength(0);
  });

  it("preserves styled characters, long unbroken words and hard breaks across rich A4 pages", () => {
    const first = "WWW and 日本語 with styled text. ".repeat(150);
    const second = "W".repeat(1200) + " More exact content. ".repeat(150);
    const rich: LetterRichDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { paragraphSpacing: 32, lineSpacing: 2.5 },
          content: [
            {
              type: "text",
              text: first,
              marks: [
                { type: "textStyle", attrs: { fontSize: "36pt", fontFamily: "Lora" } },
                { type: "bold" },
              ],
            },
            { type: "hardBreak" },
            { type: "hardBreak" },
            {
              type: "text",
              text: second,
              marks: [
                { type: "italic" },
                {
                  type: "textStyle",
                  attrs: { fontSize: "27.5pt", fontFamily: "IBM Plex Mono" },
                },
              ],
            },
          ],
        },
      ],
    };
    for (const template of LETTER_TEMPLATES) {
      const form = {
        ...example(),
        template: template.id,
        rich_document: rich,
        show_company_header: false,
        use_letterhead: true,
        letterhead: { background: image },
      };
      const pages = paginateLetter(form);
      const parts = pages.flatMap((page) => page.parts).filter((part) => part.runs);
      expect(pages.length).toBeGreaterThan(10);
      expect(parts.map((part) => part.text).join("")).toBe(`${first}\n\n${second}`);
      expect(
        parts
          .flatMap((part) => part.runs!)
          .filter((run) => run.italic)
          .map((run) => run.text)
          .join("")
      ).toBe(second);
      for (const page of pages)
        expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
    }
  });

  it("escapes rich text and uses issued assets only, without duplicating existing canvas marks", () => {
    const rich: LetterRichDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: '<img src="x" onerror="unsafe()"><script>unsafe()</script>',
            },
          ],
        },
        { type: "companySignature", attrs: { label: "" } },
        { type: "companyStamp", attrs: { label: "" } },
      ],
    };
    const assets = {
      signature: { ...SIGN_DEFAULT, data: image },
      stamp: { ...STAMP_DEFAULT, data: image },
    };
    const form = {
      ...example(),
      rich_document: rich,
      show_signature: true,
      show_stamp: true,
    };
    const draft = documentFor(form, assets);
    expect(draft.querySelectorAll("[data-doc-mark]")).toHaveLength(2);
    expect(draft.querySelectorAll("script")).toHaveLength(0);
    expect(draft.querySelectorAll("img")).toHaveLength(2);
    expect(draft.textContent).toContain('<img src="x" onerror="unsafe()">');
    const issued = documentFor({ ...form, status: "issued" }, assets);
    expect(issued.querySelectorAll("[data-doc-mark],img")).toHaveLength(0);
    expect(issued.querySelectorAll("[data-letter-manual-mark]")).toHaveLength(2);
  });

  it("renders every template as a complete A4 letter without invoice fields", () => {
    const layouts = new Set<string>();
    for (const template of LETTER_TEMPLATES) {
      const host = documentFor({ ...example(), template: template.id });
      const sheet = host.firstElementChild as HTMLElement;
      layouts.add(sheet.className);
      expect(sheet.dataset.letterTemplate).toBe(template.id);
      expect(sheet.dataset.pdfSingle).toBe("true");
      expect(sheet.style.width).toBe("794px");
      expect(sheet.style.height).toBe("1123px");
      for (const text of [
        "Northline Trading",
        "Employment confirmation",
        "Alex Morgan",
        "Position",
        "Sales Manager",
        "Effective date",
        "We confirm your appointment.",
        "Yours sincerely,",
        "Jamie Smith",
        "Page 1 of 1",
      ])
        expect(host.textContent).toContain(text);
      expect(host.textContent).not.toMatch(
        /Invoice|Subtotal|Amount due|VAT|Bank details/
      );
      expect(host.querySelectorAll("img")).toHaveLength(0);
    }
    expect(layouts.size).toBe(3);
  });

  it("keeps the ordered blocks, explicit alignment, and closing in the saved order", () => {
    const form = example();
    form.body = "Intro before blocks.";
    form.blocks = [
      { id: "first", type: "text", text: "First custom paragraph.", align: "center" },
      {
        id: "second",
        type: "field",
        label: "Project",
        value: "Second value.",
        align: "right",
      },
    ];
    const host = documentFor(form);
    const content = host.textContent!;
    expect(content.indexOf("Intro before blocks.")).toBeLessThan(
      content.indexOf("First custom paragraph.")
    );
    expect(content.indexOf("First custom paragraph.")).toBeLessThan(
      content.indexOf("Second value.")
    );
    expect(content.indexOf("Second value.")).toBeLessThan(
      content.indexOf("Yours sincerely,")
    );
    expect(
      (host.querySelector('[data-letter-source="first"]') as HTMLElement).style.textAlign
    ).toBe("center");
    expect(
      (host.querySelector('[data-letter-source="second"]') as HTMLElement).style.textAlign
    ).toBe("right");
  });

  it("paginates oversized paragraphs and custom values without losing characters or clipping the content budget", () => {
    const form = example();
    form.body = "A long employment letter — including 日本語.\n\n".repeat(1000);
    const value =
      "Delivery instructions " +
      "W".repeat(300) +
      "\n".repeat(2) +
      "Keep every word. ".repeat(500);
    form.blocks = [
      {
        id: "long-field",
        type: "field",
        label: "Special conditions",
        value,
        align: "left",
      },
    ];
    form.company_name = "Wide Company Name ".repeat(8);
    form.title = "Important subject ".repeat(10);
    for (const letterhead of [false, true]) {
      const pages = paginateLetter({
        ...form,
        use_letterhead: letterhead,
        letterhead: { background: image },
      });
      expect(pages.length).toBeGreaterThan(5);
      expect(
        pages
          .flatMap((page) => page.parts)
          .filter((part) => part.sourceId === "body")
          .map((part) => part.text)
          .join("")
      ).toBe(form.body);
      expect(
        pages
          .flatMap((page) => page.parts)
          .filter((part) => part.sourceId === "long-field")
          .map((part) => part.text)
          .join("")
      ).toBe(value);
      for (const page of pages)
        expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
      const closing = pages
        .flatMap((page) => page.parts)
        .filter((part) => part.sourceId === "closing");
      expect(closing.map((part) => part.text).join("")).toBe(form.closing);
    }
  });

  it("requires opt-in for company images and never applies current-company images to issued letters", () => {
    const assets = {
      signature: { ...SIGN_DEFAULT, data: image },
      stamp: { ...STAMP_DEFAULT, data: image },
    };
    const form = { ...example(), company_logo: image, ...assets };
    expect(documentFor(form, assets).querySelectorAll("img")).toHaveLength(0);
    const enabled = { ...form, show_logo: true, show_signature: true, show_stamp: true };
    const host = documentFor(enabled);
    expect(host.querySelectorAll("img")).toHaveLength(3);
    expect(host.querySelectorAll('[data-doc-mark="Signature"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-doc-mark="Stamp"]')).toHaveLength(1);
    const issued = {
      ...enabled,
      status: "issued" as const,
      signature: undefined,
      stamp: undefined,
    };
    expect(documentFor(issued, assets).querySelectorAll("[data-doc-mark]")).toHaveLength(
      0
    );
    expect(
      documentFor({ ...issued, status: "draft" }, assets).querySelectorAll(
        "[data-doc-mark]"
      )
    ).toHaveLength(2);
  });

  it("keeps placed marks with their labels and respects opacity/crop on the saved image", () => {
    const form = {
      ...example(),
      show_signature: true,
      signature: { ...SIGN_DEFAULT, data: image, scale: 500, opacity: 100, cropLeft: 12 },
      blocks: [
        {
          id: "signature-block",
          type: "signature" as const,
          label: "Authorized signature",
          align: "right" as const,
        },
      ],
    };
    const pages = paginateLetter(form);
    for (const page of pages)
      expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
    const host = documentFor(form);
    expect(host.querySelectorAll("[data-doc-mark]")).toHaveLength(1);
    const mark = host.querySelector('[data-letter-source="signature-block"]')!;
    expect(mark.textContent).toContain("Authorized signature");
    expect((mark as HTMLElement).style.textAlign).toBe("right");
    const img = mark.querySelector("img")!;
    expect(img.style.opacity).toBe("1");
    expect(img.style.clipPath).toBe("inset(0% 0% 0% 12%)");
  });

  it("prints a manual signing space for a placed signature/stamp without enabling an image", () => {
    const form = {
      ...example(),
      blocks: [
        {
          id: "approval",
          type: "signature" as const,
          label: "Approved by",
          align: "right" as const,
        },
        {
          id: "company-stamp",
          type: "stamp" as const,
          label: "",
          align: "left" as const,
        },
      ],
    };
    const host = documentFor(form);
    expect(host.querySelectorAll("img, [data-doc-mark]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-letter-manual-mark]")).toHaveLength(2);
    expect(host.querySelector('[data-letter-source="approval"]')!.textContent).toBe(
      "Approved by"
    );
    expect(host.querySelector('[data-letter-source="company-stamp"]')!.textContent).toBe(
      "Company stamp"
    );
    expect(
      (host.querySelector('[data-letter-manual-mark="signature"]') as HTMLElement).style
        .height
    ).toBe("64px");
    expect(host.querySelector('[data-letter-source="closing-signature"]')).toBeNull();
    for (const page of paginateLetter(form))
      expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
  });

  it("uses private company asset resolution for letterhead instead of a raw private img URL", () => {
    const host = documentFor({
      ...example(),
      show_company_header: false,
      use_letterhead: true,
      letterhead: { background: "workspace-id/company/letterhead.png" },
    });
    const background = host.querySelector(".letter-background")!;
    expect(background.getAttribute("data-company-asset-status")).toBe("loading");
    expect(background.getAttribute("src")).toBeNull();
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect((host.querySelector(".letter-content") as HTMLElement).style.paddingTop).toBe(
      "150px"
    );
    expect(host.textContent).not.toContain("Northline Trading");
  });

  it("renders text as text, falls back from an unknown template, and clamps a selected preview page", () => {
    const form = {
      ...example(),
      title: '<img src="x" onerror="alert(1)">',
      template: "unknown",
      body: "<script>unsafe()</script>",
      font: "Arial; height: 99999px",
    };
    const host = documentFor(form, undefined, 999);
    expect(host.querySelectorAll("img,script")).toHaveLength(0);
    expect(host.textContent).toContain(form.title);
    expect(host.textContent).toContain(form.body);
    expect((host.firstElementChild as HTMLElement).dataset.letterTemplate).toBe(
      "letter-standard"
    );
    expect((host.firstElementChild as HTMLElement).style.fontFamily).toBe(
      "Inter, Arial, sans-serif"
    );
    expect(host.children).toHaveLength(1);
  });

  it("keeps legacy references and hides an optional reference on every printed page while retaining date and page numbers", () => {
    const form = { ...example(), body: "Multiple-page wording.\n".repeat(160) };
    delete form.show_reference;
    delete form.show_company_header;
    delete form.text_style;
    delete form.title_style;
    const legacy = documentFor(form);
    expect(legacy.textContent).toContain("Reference: LTR-2026-014");
    expect(legacy.textContent).toContain("LTR-2026-014 · continued");
    expect(legacy.textContent).toContain("Northline Trading");
    expect(
      paginateLetter(form)
        .flatMap((page) => page.parts)
        .find((part) => part.sourceId === "body")
    ).toEqual(expect.objectContaining({ size: 13, lineHeight: 22, weight: 400 }));
    const hidden = documentFor({ ...form, show_reference: false });
    expect(hidden.children.length).toBeGreaterThan(1);
    expect(hidden.textContent).not.toContain(form.number);
    expect(hidden.textContent).not.toContain("Reference:");
    expect(hidden.textContent).toContain("Date:");
    expect(hidden.textContent).toContain(
      `Page ${hidden.children.length} of ${hidden.children.length}`
    );
    expect(hidden.textContent).toContain("Continued");
  });

  it("toggles the automatic company header independently from the full-page letterhead", () => {
    const form = {
      ...example(),
      use_letterhead: true,
      letterhead: { background: image },
      show_logo: true,
      company_logo: image,
    };
    const both = documentFor({ ...form, show_company_header: true });
    expect(both.textContent).toContain("Northline Trading");
    expect(both.querySelectorAll("img")).toHaveLength(2);
    const backgroundOnly = documentFor({
      ...form,
      show_company_header: false,
      show_logo: false,
    });
    expect(backgroundOnly.textContent).not.toContain("Northline Trading");
    expect(backgroundOnly.querySelectorAll("img")).toHaveLength(1);
    expect(backgroundOnly.querySelector(".letter-background")).not.toBeNull();
    const plain = documentFor({
      ...form,
      show_company_header: false,
      use_letterhead: false,
      show_logo: false,
    });
    expect(plain.querySelectorAll("img")).toHaveLength(0);
    expect(plain.textContent).not.toContain("Northline Trading");
  });

  it("can print only the company logo when company details are explicitly hidden", () => {
    const form = {
      ...example(),
      show_company_header: false,
      show_logo: true,
      company_logo: image,
    };
    const logoOnly = documentFor(form);
    expect(logoOnly.querySelectorAll("img")).toHaveLength(1);
    expect(logoOnly.querySelector('[data-letter-source="company-logo"]')).not.toBeNull();
    expect(logoOnly.textContent).not.toContain("Northline Trading");
    expect(logoOnly.querySelector('[data-letter-source="company-name"]')).toBeNull();
    const hidden = documentFor({ ...form, show_logo: false });
    expect(hidden.querySelectorAll("img")).toHaveLength(0);
    expect(hidden.querySelector('[data-letter-source="company-logo"]')).toBeNull();
  });

  it("preserves the historical background-only header on an issued letter without the new header flag", () => {
    const form = {
      ...example(),
      status: "issued" as const,
      use_letterhead: true,
      letterhead: { background: image },
      company_logo: image,
      show_logo: true,
    };
    delete form.show_company_header;
    const legacy = documentFor(form);
    expect(legacy.textContent).not.toContain("Northline Trading");
    expect(legacy.querySelectorAll("img")).toHaveLength(1);
    expect(legacy.querySelector(".letter-background")).not.toBeNull();
    expect(legacy.textContent).toContain("Employment confirmation");
    const explicit = documentFor({ ...form, show_company_header: true });
    expect(explicit.textContent).toContain("Northline Trading");
    expect(explicit.querySelectorAll("img")).toHaveLength(2);
  });

  it("merges paragraph formatting with explicit block overrides and applies paragraph spacing only at paragraph starts", () => {
    const form = {
      ...example(),
      body: "Opening paragraph.\nAnother paragraph.",
      text_style: {
        font: "classic" as const,
        fontSize: 12,
        bold: true,
        italic: true,
        underline: true,
        color: "#234567",
        lineSpacing: 1.75,
        paragraphSpacing: 12,
        align: "right" as const,
      },
      blocks: [
        {
          id: "override",
          type: "text" as const,
          text: "A custom block.",
          align: "left" as const,
          style: {
            font: "mono" as const,
            fontSize: 9,
            bold: false,
            italic: false,
            underline: false,
            color: "#654321",
            align: "center" as const,
          },
        },
      ],
    };
    const parts = paginateLetter(form).flatMap((page) => page.parts);
    const body = parts.filter((part) => part.sourceId === "body");
    expect(body.map((part) => part.text).join("")).toBe(form.body);
    expect(body.map((part) => part.gap)).toEqual([12, 12]);
    expect(body[0]).toEqual(
      expect.objectContaining({
        size: 16,
        lineHeight: 28,
        weight: 700,
        italic: true,
        underline: true,
        color: "#234567",
        font: "'Lora', Georgia, serif",
        align: "right",
      })
    );
    const override = parts.find((part) => part.sourceId === "override")!;
    expect(override).toEqual(
      expect.objectContaining({
        size: 12,
        lineHeight: 21,
        weight: 400,
        italic: false,
        underline: false,
        color: "#654321",
        font: "'IBM Plex Mono', monospace",
        align: "center",
      })
    );
    const host = documentFor(form);
    const renderedBody = host.querySelector('[data-letter-source="body"]') as HTMLElement;
    expect(renderedBody.style.fontStyle).toBe("italic");
    expect(renderedBody.style.textDecoration).toBe("underline");
    expect(renderedBody.style.fontSize).toBe("16px");
    expect(renderedBody.style.lineHeight).toBe("28px");
    const renderedOverride = host.querySelector(
      '[data-letter-source="override"]'
    ) as HTMLElement;
    expect(renderedOverride.style.fontStyle).toBe("");
    expect(renderedOverride.style.textDecoration).toBe("");
    expect(renderedOverride.style.fontWeight).toBe("400");
  });

  it("formats titles and field/date values while keeping field labels compact", () => {
    const form = {
      ...example(),
      template: "letter-modern",
      text_style: { fontSize: 18, lineSpacing: 2, paragraphSpacing: 8 },
      title_style: {
        font: "modern" as const,
        fontSize: 22,
        bold: true,
        italic: true,
        underline: true,
        color: "#123456",
        lineSpacing: 1.2,
        align: "center" as const,
      },
      blocks: [
        {
          id: "field",
          type: "field" as const,
          label: "Project",
          value: "Warehouse extension",
          align: "left" as const,
        },
        {
          id: "date",
          type: "date" as const,
          label: "Effective date",
          value: "2026-10-03",
          align: "left" as const,
          style: { fontSize: 10, bold: true },
        },
      ],
    };
    const parts = paginateLetter(form).flatMap((page) => page.parts);
    const title = parts.find((part) => part.sourceId === "title")!;
    expect(title.size).toBeCloseTo((22 * 4) / 3);
    expect(title.lineHeight).toBeCloseTo(title.size * 1.2);
    expect(title.weight).toBe(700);
    expect(title.align).toBe("center");
    expect(title.font).toBe("Inter, Arial, sans-serif");
    expect(parts.find((part) => part.sourceId === "field-label")).toEqual(
      expect.objectContaining({ size: 10, lineHeight: 16, gap: 8 })
    );
    expect(parts.find((part) => part.sourceId === "field")).toEqual(
      expect.objectContaining({ size: 24, lineHeight: 48, gap: 0 })
    );
    expect(parts.find((part) => part.sourceId === "date")!.size).toBeCloseTo(
      (10 * 4) / 3
    );
    const host = documentFor(form);
    expect(
      (host.querySelector('[data-letter-source="title"]') as HTMLElement).style.fontWeight
    ).toBe("700");
  });

  it("preserves custom decimal size and spacing in pagination and the exported sheet DOM", () => {
    const style = { fontSize: 13.5, lineSpacing: 1.35, paragraphSpacing: 7.5 };
    const form = {
      ...example(),
      body: "First paragraph.\nSecond paragraph.",
      text_style: style,
      title_style: style,
      blocks: [
        {
          id: "custom",
          type: "text" as const,
          align: "left" as const,
          text: "Custom block paragraph.\nAnother custom paragraph.",
          style,
        },
      ],
    };
    const pages = paginateLetter(form);
    expect(pages).toHaveLength(1);
    const parts = pages.flatMap((page) => page.parts);
    const host = documentFor(form);
    for (const source of ["body", "title", "custom"]) {
      const textParts = parts.filter((part) => part.sourceId === source);
      for (const part of textParts) {
        expect(part.size).toBe(18);
        expect(part.lineHeight).toBeCloseTo(24.3);
        expect(part.height).toBeCloseTo(24.3);
        expect(part.gap).toBe(7.5);
      }
      const rendered = host.querySelectorAll<HTMLElement>(
        `[data-letter-source="${source}"]`
      );
      expect(rendered).toHaveLength(textParts.length);
      for (const part of rendered) {
        expect(part.style.fontSize).toBe("18px");
        expect(part.style.lineHeight).toBe("24.3px");
        expect(part.style.marginTop).toBe("7.5px");
      }
    }
    expect(
      parts
        .filter((part) => part.sourceId === "body")
        .map((part) => part.text)
        .join("")
    ).toBe(form.body);
    expect(pages[0].usedHeight).toBeLessThanOrEqual(pages[0].availableHeight);
    expect((host.firstElementChild as HTMLElement).dataset.pdfSingle).toBe("true");
    expect(form.text_style).toEqual(style);
  });

  it("budgets large bold italic fonts and spacing without losing long text across styled A4 pages", () => {
    const source =
      "Large-font wording with WWW and 日本語 — keep all characters.\n".repeat(170);
    for (const font of ["modern", "classic", "mono"] as const) {
      const form = {
        ...example(),
        show_company_header: false,
        use_letterhead: true,
        letterhead: { background: image },
        body: source,
        text_style: {
          font,
          fontSize: 36,
          bold: true,
          italic: true,
          lineSpacing: 2.5,
          paragraphSpacing: 32,
        },
      };
      const pages = paginateLetter(form);
      expect(pages.length).toBeGreaterThan(10);
      expect(
        pages
          .flatMap((page) => page.parts)
          .filter((part) => part.sourceId === "body")
          .map((part) => part.text)
          .join("")
      ).toBe(source);
      for (const page of pages)
        expect(page.usedHeight).toBeLessThanOrEqual(page.availableHeight);
    }
  });
});
