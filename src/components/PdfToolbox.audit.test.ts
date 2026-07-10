// Runtime audit of the Tools section: run every non-interactive tool in
// PDF_TOOLS against a small generated fixture and record pass/fail. Tools
// whose engines need a real browser (canvas 2D, Web Workers, WASM loaders,
// OCR) can't run under jsdom — they're expected to fail here and are listed
// in ENV_LIMITED; a failure OUTSIDE that list is a real regression.
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDF_TOOLS, defaultParams, type Tool } from "./PdfToolbox";

// jsdom's File/Blob lack arrayBuffer()/text() — polyfill via FileReader so
// the tools (which run fine in real browsers) can execute here.
for (const proto of [Blob.prototype, File.prototype]) {
  if (!proto.arrayBuffer)
    proto.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as ArrayBuffer);
        r.onerror = () => rej(r.error);
        r.readAsArrayBuffer(this);
      });
    };
  if (!proto.text)
    proto.text = function (this: Blob) {
      return new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result ?? ""));
        r.onerror = () => rej(r.error);
        r.readAsText(this);
      });
    };
}

// Tools whose defaults are intentionally not runnable (validation demands
// user input) get the minimum params to exercise the real code path.
const PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  encrypt: { userPassword: "secret123" },
  permissions: { ownerPassword: "secret123" },
  "split-at": { points: "2" },
};

// Engines that need browser APIs jsdom doesn't have. Kept tight on purpose:
// shrinking this list is progress, growing it needs a reason.
const ENV_LIMITED = new Set([
  // canvas 2D rendering (pdfjs page render / image pipelines)
  "pdf2img", "extract-images", "svg2img", "img2svg", "img-compress",
  "compress", "greyscale", "invert", "rasterize", "deskew", "posterize",
  "repair", "pdf2tiff", "tiff2pdf", "thumbnail", "pdf-preview",
  // OCR (tesseract workers)
  "ocr-pdf", "ocr-text",
  // Office/HTML render pipelines (html-to-image → canvas)
  "word2pdf", "excel2pdf", "ppt2pdf", "rtf2pdf", "img2pdf", "heic-to-pdf",
  "psd-to-pdf", "cbz2pdf",
  // pdfjs text/structure extraction (needs worker; flaky under jsdom)
  "pdf2txt", "pdf2json", "pdf2docx", "pdf2xlsx", "pdf2pptx", "compare",
  "extract-tables", "remove-blank", "pdf2zip",
  // pdfjs-backed passes (same worker limitation)
  "pdf-flatten", "extract-attach", "decrypt",
]);

async function makePdf(pages = 2, name = "fixture.pdf"): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Fixture page ${i + 1} — hello Filey`, {
      x: 60,
      y: 760,
      size: 14,
      font,
    });
  }
  const bytes = await doc.save();
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

// 1×1 red PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function makePng(): File {
  const bin = atob(PNG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], "fixture.png", { type: "image/png" });
}

const textFile = (name: string, type: string, body: string) =>
  new File([body], name, { type });

// PDF with an AcroForm matching fill-form's default JSON ({Name, Agree}).
async function makeFormPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const name = form.createTextField("Name");
  name.addToPage(page, { x: 60, y: 700, width: 200, height: 24 });
  const agree = form.createCheckBox("Agree");
  agree.addToPage(page, { x: 60, y: 660, width: 18, height: 18 });
  const bytes = await doc.save();
  return new File([new Uint8Array(bytes)], "form.pdf", { type: "application/pdf" });
}

const FORM_TOOLS = new Set(["list-fields", "fill-form", "flatten-form"]);

async function fixtureFor(t: Tool): Promise<File[] | null> {
  const a = t.accept.toLowerCase();
  const n = t.multi ? 2 : 1;
  if (FORM_TOOLS.has(t.id)) return [await makeFormPdf()];
  if (a.includes("pdf")) {
    const files: File[] = [];
    for (let i = 0; i < n; i++) files.push(await makePdf(2, `fixture-${i}.pdf`));
    return files;
  }
  if (a.includes("image") || a.includes("png")) return [makePng()];
  if (a.includes("csv")) return [textFile("f.csv", "text/csv", "a,b\n1,2\n3,4\n")];
  if (a.includes("json")) return [textFile("f.json", "application/json", '[{"a":1,"b":2}]')];
  if (a.includes("markdown") || a.includes(".md"))
    return [textFile("f.md", "text/markdown", "# Title\n\nHello **world**\n")];
  if (a.includes("text") || a.includes(".txt"))
    return [textFile("f.txt", "text/plain", "Hello Filey\nline two\n")];
  return null; // no fixture for this format (heic/psd/office binaries…)
}

describe("Tools registry", () => {
  it("has no duplicate tool ids", () => {
    const seen = new Map<string, number>();
    for (const t of PDF_TOOLS) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
    const dups = [...seen].filter(([, c]) => c > 1).map(([id]) => id);
    expect(dups).toEqual([]);
  });

  it("every non-interactive tool runs on a fixture (except known env limits)", async () => {
    const failures: string[] = [];
    const passed: string[] = [];
    const skipped: string[] = [];

    for (const t of PDF_TOOLS) {
      if (t.interactive) {
        skipped.push(`${t.id} (interactive studio)`);
        continue;
      }
      if (ENV_LIMITED.has(t.id)) {
        skipped.push(`${t.id} (browser-only engine)`);
        continue;
      }
      const files = await fixtureFor(t);
      if (!files) {
        skipped.push(`${t.id} (no jsdom fixture for ${t.accept})`);
        continue;
      }
      try {
        const outs = await t.run(files, {
          ...defaultParams(t),
          ...PARAM_OVERRIDES[t.id],
        });
        if (!outs.length || outs.some((o) => !o.bytes || o.bytes.byteLength === 0))
          throw new Error("empty output");
        passed.push(t.id);
      } catch (e: any) {
        failures.push(`${t.id}: ${e?.message ?? e}`);
      }
    }

    // Visible audit trail in the vitest output.
    console.info(
      `[tools-audit] passed=${passed.length} skipped=${skipped.length} failed=${failures.length}`
    );
    if (failures.length) console.info("[tools-audit] failures:\n  " + failures.join("\n  "));
    expect(failures).toEqual([]);
  }, 120_000);
});
