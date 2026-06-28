// @vitest-environment jsdom
// Smoke test for the local PDF/file toolkit: build a sample PDF and run every
// pdf-lib / pure-JS tool, asserting each returns valid, non-empty output. Tools
// that need a real canvas / pdf.js worker / wasm (rasterize, OCR, image convert)
// can't run headlessly and are listed at the bottom — they're verified in-app.
import { beforeAll, test, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

beforeAll(() => {
  // pdfjs-dist references these DOM globals at import time; jsdom lacks them.
  // The pdf-lib tools never invoke pdfjs, so empty stubs just let the module load.
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = class DOMMatrix {};
  if (typeof g.Path2D === "undefined") g.Path2D = class Path2D {};
  if (typeof g.ImageData === "undefined")
    g.ImageData = class ImageData {
      constructor(public width = 1, public height = 1) {}
    };
  if (!Blob.prototype.arrayBuffer) {
    // eslint-disable-next-line no-extend-native
    Blob.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(this as unknown as Blob);
      });
    };
  }
  if (!Blob.prototype.text) {
    // eslint-disable-next-line no-extend-native
    Blob.prototype.text = function () {
      return (this as unknown as Blob)
        .arrayBuffer()
        .then((b) => new TextDecoder().decode(b));
    };
  }
});

async function samplePdf(pages = 3): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Page ${i + 1} — sample`, { x: 50, y: 800, size: 18, font });
  }
  return new File([new Uint8Array(await doc.save())], "sample.pdf", {
    type: "application/pdf",
  });
}

// A valid 1x1 transparent PNG (so pdf-lib embedPng has real bytes to work with).
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(PNG_1x1), (c) => c.charCodeAt(0));
const pngFile = () => new File([pngBytes], "dot.png", { type: "image/png" });
const pngDataUrl = `data:image/png;base64,${PNG_1x1}`;
const fileOf = (s: string, name: string, type: string) =>
  new File([s], name, { type });

// Duck-typed (not instanceof) — pdf-lib / TextEncoder may produce a Uint8Array
// from a different realm under jsdom, which would fail an instanceof check.
const nonEmpty = (o: any) => !!(o && o.bytes && o.bytes.length > 0);
const isPdf = (o: any) =>
  nonEmpty(o) && new TextDecoder().decode(o.bytes.slice(0, 5)) === "%PDF-";

test("PDF toolkit: every headless tool runs and produces valid output", async () => {
  const T = await import("../pdfTools");
  const pdf = await samplePdf(4);
  const csv = fileOf("a,b,c\n1,2,3\n4,5,6\n", "t.csv", "text/csv");
  const json = fileOf('[{"a":1,"b":2},{"a":3,"b":4}]', "t.json", "application/json");
  const txt = fileOf("Hello world\nSecond line\n", "t.txt", "text/plain");

  // [name, () => Promise<OutFile|number|...>, validator]
  const cases: [string, () => Promise<any>, (r: any) => boolean][] = [
    ["pageCount", () => T.pageCount(pdf), (r) => r === 4],
    ["mergePdfs", async () => T.mergePdfs([pdf, await samplePdf(2)]), isPdf],
    ["extractPages", () => T.extractPages(pdf, "1-2"), isPdf],
    ["deletePages", () => T.deletePages(pdf, "2"), isPdf],
    ["splitEvery", async () => (await T.splitEvery(pdf, 2))[0], isPdf],
    ["rotatePdf", () => T.rotatePdf(pdf, 90), isPdf],
    ["addPageNumbers", () => T.addPageNumbers(pdf), isPdf],
    ["addWatermark", () => T.addWatermark(pdf, { text: "DRAFT" }), isPdf],
    ["compressPdf", () => T.compressPdf(pdf), isPdf],
    ["setPdfMeta", () => T.setPdfMeta(pdf, "Title", "Me"), isPdf],
    ["textToPdf", () => T.textToPdf(txt), isPdf],
    ["csvToPdf", () => T.csvToPdf(csv), isPdf],
    ["reversePdf", () => T.reversePdf(pdf), isPdf],
    ["addBlankPage", () => T.addBlankPage(pdf), isPdf],
    ["nupPdf", () => T.nupPdf(pdf, 2), isPdf],
    ["pdfInfo", () => T.pdfInfo(pdf), nonEmpty],
    ["csvToJson", () => T.csvToJson(csv), nonEmpty],
    ["jsonToCsv", () => T.jsonToCsv(json), nonEmpty],
    ["dividePages", () => T.dividePages(pdf, "h"), isPdf],
    ["combineToSinglePage", () => T.combineToSinglePage(pdf), isPdf],
    ["alternateMerge", async () => T.alternateMerge([pdf, await samplePdf(2)]), isPdf],
    ["cropPdf", () => T.cropPdf(pdf, 10), isPdf],
    ["removeAnnotations", () => T.removeAnnotations(pdf), isPdf],
    ["addHeaderFooter", () => T.addHeaderFooter(pdf, "Head", "Foot"), isPdf],
    ["addStamp", () => T.addStamp(pdf, "paid"), isPdf],
    ["removeMetadata", () => T.removeMetadata(pdf), isPdf],
    ["sanitizePdf", () => T.sanitizePdf(pdf), isPdf],
    ["fixPageSizeA4", () => T.fixPageSizeA4(pdf), isPdf],
    ["signPdf", () => T.signPdf(pdf, pngDataUrl), isPdf],
    ["signPdfAt", () => T.signPdfAt(pdf, pngDataUrl, 0, 40, 40, 80), isPdf],
    ["imagesToPdf", () => T.imagesToPdf([pngFile()]), isPdf],
    ["jsonToPdf", () => T.jsonToPdf(json), isPdf],
    ["markdownToPdf", () => T.markdownToPdf(fileOf("# Title\n\nBody", "t.md", "text/markdown")), isPdf],
    ["reorderPages", () => T.reorderPages(pdf, "4,3,2,1"), isPdf],
    ["splitAtPages", async () => (await T.splitAtPages(pdf, "2"))[0], isPdf],
    ["bookletOrder", () => T.bookletOrder(pdf), isPdf],
    ["gridCombine", () => T.gridCombine(pdf, 2, 2), isPdf],
    ["backgroundColor", () => T.backgroundColor(pdf, "#ffeecc"), isPdf],
    ["cropPdf/removeRestrictions", () => T.removeRestrictions(pdf), isPdf],
    ["repairPdf", () => T.repairPdf(pdf), isPdf],
    ["linearizePdf", () => T.linearizePdf(pdf), isPdf],
    ["fixPageSizeA4", () => T.fixPageSizeA4(pdf), isPdf],
    ["organizePages", () => T.organizePages(pdf, [{ index: 0 }, { index: 2 }]), isPdf],
    ["pageDimensionsText", () => T.pageDimensionsText(pdf), nonEmpty],
    ["listFormFields", () => T.listFormFields(pdf), nonEmpty],
    ["addBlankPage", () => T.addBlankPage(pdf), isPdf],
  ];

  const failures: { name: string; err: string }[] = [];
  for (const [name, run, ok] of cases) {
    try {
      const r = await run();
      if (!ok(r)) failures.push({ name, err: `invalid output: ${JSON.stringify(r)?.slice(0, 80)}` });
    } catch (e: any) {
      failures.push({ name, err: e?.message || String(e) });
    }
  }

  if (failures.length) {
    // Surface every failing tool at once.
    throw new Error("Failing tools:\n" + failures.map((f) => `  ${f.name}: ${f.err}`).join("\n"));
  }
  expect(failures).toEqual([]);
});
