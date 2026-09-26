// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveObjectURL } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, DOMMatrix, Path2D, ImageData, Image } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFDict, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import type { OutFile } from "../pdfTools";

// Vite selects Mammoth's browser unzip implementation; use that same real
// implementation here instead of its Node entry (which accepts a file path).
vi.mock("mammoth", () => createRequire(import.meta.url)("mammoth/mammoth.browser.js"));

// Run the real OCR worker against the same vendored language/core files. Only
// browser URL/canvas transport is adapted to Node paths and PNG bytes.
vi.mock("tesseract.js", () => {
  const engine = createRequire(import.meta.url)("tesseract.js") as typeof import("tesseract.js");
  return { ...engine, createWorker: async (...args: Parameters<typeof engine.createWorker>) => {
    const worker = await engine.createWorker(args[0], args[1], {
      ...args[2],
      workerPath: createRequire(import.meta.url).resolve("tesseract.js/src/worker-script/node/index.js"),
      corePath: resolve("public/tesseract"),
      langPath: resolve("public/tesseract"),
      cacheMethod: "none",
    });
    const recognize = worker.recognize.bind(worker);
    worker.recognize = (input, ...rest) => recognize(
      input && typeof input === "object" && "toBuffer" in input
        ? (input as unknown as { toBuffer(type: "image/png"): Buffer }).toBuffer("image/png")
        : input,
      ...rest,
    );
    return worker;
  } };
});

// Exercise the actual production legacy parser, matching worker and renderer. The native
// canvas is PDF.js's existing optional dependency, not a mocked render result.
beforeAll(async () => {
  // Select Node worker transport before installing the browser canvas facade.
  createRequire(import.meta.url)("tesseract.js");
  vi.stubGlobal("DOMMatrix", DOMMatrix);
  vi.stubGlobal("Path2D", Path2D);
  vi.stubGlobal("ImageData", ImageData);
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser);
  // Native decoder/rendering with browser blob-URL input, without network access.
  vi.stubGlobal("Image", function BrowserImage() {
    const image = new Image();
    const src = Object.getOwnPropertyDescriptor(Image.prototype, "src")!;
    Object.defineProperty(image, "src", {
      get: () => src.get!.call(image),
      set(value: string | Uint8Array) {
        if (typeof value === "string" && value.startsWith("blob:")) {
          const blob = resolveObjectURL(value);
          if (!blob) throw new Error("Unknown test image URL");
          void blob.arrayBuffer().then((bytes) => src.set!.call(image, new Uint8Array(bytes)));
        } else src.set!.call(image, value);
      },
    });
    return image;
  });
  vi.stubGlobal("fetch", async (url: string) => {
    if (!String(url).endsWith("vtracer.wasm")) throw new Error(`Unexpected network request: ${url}`);
    const bytes = await readFile(createRequire(import.meta.url).resolve("vtracer-wasm/vtracer.wasm"));
    return new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
  });
  vi.stubGlobal("document", {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`Unexpected document element: ${tag}`);
      return createCanvas(1, 1);
    },
  });
  const worker = createRequire(import.meta.url).resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal(
    "pdfjsWorker",
    await import(/* @vite-ignore */ pathToFileURL(worker).href)
  );
});
afterAll(() => vi.unstubAllGlobals());

it("does not enlarge already optimized PDFs and gives scanned text exports an OCR recovery path", async () => {
  const tools = await import("../pdfTools");
  const { toolById } = await import("../../components/PdfToolbox");
  const blank = await PDFDocument.create(); blank.addPage([200, 300]);
  const file = new File([new Uint8Array(await blank.save())], "scan.pdf", { type: "application/pdf" });
  const compressed = await tools.compressPdf(file);
  expect(compressed.bytes.length).toBeLessThanOrEqual(file.size);
  expect((await PDFDocument.load(compressed.bytes)).getPageCount()).toBe(1);
  await expect(toolById("pdf2txt")!.run([file], {})).rejects.toThrow("OCR to Text");
  await expect(tools.pdfToJsonText(file)).rejects.toThrow("OCR to PDF");
});

const asFile = (out: { name: string; bytes: Uint8Array }) =>
  new File([out.bytes.slice()], out.name, { type: "application/pdf" });

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([160, 100]);
  page.drawText("Filey invoice 42", { x: 10, y: 70, size: 12, font });
  page.drawRectangle({ x: 0, y: 0, width: 20, height: 20, color: rgb(0, 0, 0) });
  return new File([new Uint8Array(await doc.save())], "invoice.pdf", {
    type: "application/pdf",
  });
}

it("parses text and renders an actual PDF with the installed matching PDF.js worker", async () => {
  const { getDocument, pdfjs } = await import("../pdfjsSafe");
  const task = getDocument({
    data: new Uint8Array(await (await sample()).arrayBuffer()),
    useSystemFonts: true,
  });
  const document = await task.promise;
  try {
    expect(pdfjs.version).toBe(
      createRequire(import.meta.url)("pdfjs-dist/package.json").version
    );
    expect(document.numPages).toBe(1);
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    expect(
      text.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ")
    ).toContain("Filey invoice 42");
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    expect(Array.from(context.getImageData(10, 90, 1, 1).data)).toEqual([0, 0, 0, 255]);
    expect(Array.from(context.getImageData(140, 90, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ]);
  } finally {
    await task.destroy();
  }
}, 15_000); // Real worker/font initialization competes with the full parallel suite.

it("exports a PDF through Filey's real PNG and PowerPoint flows, with PNG-only slide media", async () => {
  const tools = await import("../pdfTools");
  const file = await sample();
  const extracted = await tools.pdfToText(file);
  expect(new TextDecoder().decode(extracted.bytes)).toContain("Filey invoice 42");
  const images = await tools.pdfToImageFormat(file, "png", 1);
  expect(images).toHaveLength(1);
  expect(Array.from(images[0].bytes.subarray(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const deck = await tools.pdfToPptx(file);
  expect(deck.name).toBe("invoice.pptx");
  const archive = await JSZip.loadAsync(deck.bytes);
  expect(archive.file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(1);
  const media = archive.file(/^ppt\/media\/[^/]+$/);
  expect(media).toHaveLength(1);
  const png = await media[0].async("uint8array");
  expect(media[0].name).toMatch(/\.png$/);
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

it("rejects unavailable page rendering and failed PNG encoding instead of omitting pages or hanging", async () => {
  const tools = await import("../pdfTools");
  const file = await sample();
  const create = vi.spyOn(document, "createElement");
  try {
    create.mockImplementation(
      () =>
        Object.assign(createCanvas(1, 1), {
          getContext: () => null,
        }) as unknown as HTMLCanvasElement
    );
    await expect(tools.pdfToPptx(file)).rejects.toThrow(
      "Cannot render PDF page 1: canvas is unavailable."
    );
    create.mockImplementation(
      () =>
        Object.assign(createCanvas(1, 1), {
          toBlob: (callback: BlobCallback) => callback(null),
        }) as unknown as HTMLCanvasElement
    );
    await expect(tools.pdfToImages(file)).rejects.toThrow(
      "Could not encode PDF page 1 as PNG."
    );
  } finally {
    create.mockRestore();
  }
});

it("writes a real BMP with correct dimensions and bottom-up pixels", async () => {
  const tools = await import("../pdfTools");
  const [image] = await tools.pdfToImageFormat(await sample(), "bmp", 1);
  expect(image.name).toBe("invoice-p1.bmp");
  const header = new DataView(image.bytes.buffer, image.bytes.byteOffset);
  expect(new TextDecoder().decode(image.bytes.subarray(0, 2))).toBe("BM");
  expect(header.getUint32(2, true)).toBe(image.bytes.length);
  expect(header.getInt32(18, true)).toBe(160);
  expect(header.getInt32(22, true)).toBe(100);
  expect(Array.from(image.bytes.subarray(54 + 10 * 3, 54 + 10 * 3 + 3))).toEqual([0, 0, 0]);
  expect(Array.from(image.bytes.subarray(54 + 140 * 3, 54 + 140 * 3 + 3))).toEqual([255, 255, 255]);
});

it("redacts source text permanently and uses the displayed coordinates on rotated pages", async () => {
  const tools = await import("../pdfTools");
  const { getDocument } = await import("../pdfjsSafe");
  const rotated = asFile(await tools.rotatePdf(await sample(), 90));
  const redacted = asFile(await tools.redactBoxes(rotated, [
    { page: 0, xFrac: 0, yFrac: 0, wFrac: 0.5, hFrac: 0.5 },
  ]));
  expect(new TextDecoder().decode((await tools.pdfToText(redacted)).bytes)).not.toContain("Filey");
  const task = getDocument({ data: new Uint8Array(await redacted.arrayBuffer()) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  expect([viewport.width, viewport.height]).toEqual([100, 160]);
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  expect(Array.from(context.getImageData(25, 40, 1, 1).data)).toEqual([0, 0, 0, 255]);
  await task.destroy();
  await expect(tools.redactBoxes(rotated, [{ page: 8, xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 }])).rejects.toThrow("outside the document");
});

it("sanitizes actions, attachments, metadata and hidden source text", async () => {
  const tools = await import("../pdfTools");
  const source = await PDFDocument.load(await (await sample()).arrayBuffer());
  source.setAuthor("Private author");
  source.addJavaScript("secret", 'app.alert("private")');
  await source.attach(new TextEncoder().encode("Private attachment"), "private.txt");
  const input = asFile({ name: "private.pdf", bytes: await source.save() });
  const out = await tools.sanitizePdf(input);
  const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(1);
  expect(doc.context.trailerInfo.Info).toBeUndefined();
  expect(doc.getAuthor()).toBeUndefined();
  expect(doc.catalog.has(PDFName.of("Names"))).toBe(false);
  expect(doc.catalog.has(PDFName.of("OpenAction"))).toBe(false);
  expect(new TextDecoder().decode((await tools.pdfToText(asFile(out))).bytes)).not.toContain("Filey invoice");
});

it("round-trips encryption and owner restrictions without losing selectable text or pages", async () => {
  const tools = await import("../pdfTools");
  const input = await sample();
  const encrypted = asFile(await tools.encryptPdf(input, { userPassword: "open-test", ownerPassword: "owner-test", copying: false }));
  await expect(tools.reversePdf(encrypted)).rejects.toThrow("Decrypt PDF");
  await expect(tools.decryptPdf(encrypted, "wrong-test")).rejects.toThrow(/password/i);
  const opened = asFile(await tools.decryptPdf(encrypted, "open-test"));
  const doc = await PDFDocument.load(await opened.arrayBuffer());
  expect(doc.isEncrypted).toBe(false);
  expect(doc.getPageCount()).toBe(1);
  expect(new TextDecoder().decode((await tools.pdfToText(opened)).bytes)).toContain("Filey invoice 42");
  const restricted = asFile(await tools.encryptPdf(input, { ownerPassword: "owner-test", printing: false }));
  const unrestricted = asFile(await tools.removeRestrictions(restricted));
  expect(new TextDecoder().decode((await tools.pdfToText(unrestricted)).bytes)).toContain("Filey invoice 42");
}, 15_000);

it("exports every level of bookmarks and survives a malformed cyclic outline", async () => {
  const tools = await import("../pdfTools");
  const spec = "Chapter | 1\n  Section | 1\n    Detail | 1\n  Other section | 1\nAppendix | 1";
  const bookmarked = await tools.setBookmarks(await sample(), spec);
  expect(new TextDecoder().decode((await tools.extractBookmarks(asFile(bookmarked))).bytes)).toBe(spec);
  const doc = await PDFDocument.load(bookmarked.bytes);
  const root = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  const first = root.lookup(PDFName.of("First"), PDFDict);
  first.set(PDFName.of("Next"), root.get(PDFName.of("First"))!);
  const output = await tools.extractBookmarks(asFile({ name: "cycle.pdf", bytes: await doc.save() }));
  expect(new TextDecoder().decode(output.bytes)).toContain("Detail | 1");
});

it("clears existing form values and rejects non-object field data", async () => {
  const tools = await import("../pdfTools");
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const text = doc.getForm().createTextField("Customer");
  text.setText("Old customer");
  text.addToPage(page);
  const choice = doc.getForm().createDropdown("Department");
  choice.addOptions(["Sales", "Accounts"]);
  choice.select("Sales");
  choice.addToPage(page);
  const input = asFile({ name: "form.pdf", bytes: await doc.save() });
  const out = await tools.fillForm(input, '{"Customer":"","Department":""}');
  const fields = await tools.readFormFields(asFile(out));
  expect(fields.map((field) => field.value)).toEqual(["", ""]);
  await expect(tools.fillForm(input, "null")).rejects.toThrow("JSON object");
  await expect(tools.fillForm(input, "[]")).rejects.toThrow("JSON object");
});

it("keeps stamp and letterhead placement aligned on all rotated page orientations", async () => {
  const tools = await import("../pdfTools");
  const { getDocument } = await import("../pdfjsSafe");
  const image = createCanvas(20, 20);
  const context = image.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 20, 20);
  const stamp = image.toDataURL("image/png");
  const source = await PDFDocument.create();
  for (let n = 0; n < 2; n++) source.addPage([160, 100]).drawRectangle({ x: 0, y: 0, width: 1, height: 1 });
  for (const rotation of [0, 90, 180, 270]) {
    const rotated = asFile(await tools.rotatePdf(asFile({ name: "two-pages.pdf", bytes: await source.save() }), rotation));
    for (const behind of [false, true]) {
      const output = await tools.placeStamp(rotated, stamp, { xFrac: 0.25, yFrac: 0.2, wFrac: 0.25, opacity: 1, pageIndex: 0, behind });
      const task = getDocument({ data: output.bytes.slice() });
      const doc = await task.promise;
      expect(doc.numPages).toBe(2);
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect([viewport.width, viewport.height]).toEqual(rotation % 180 ? [100, 160] : [160, 100]);
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      expect(Array.from(ctx.getImageData(Math.floor(viewport.width * 0.375), Math.floor(viewport.height * 0.2 + viewport.width * 0.125), 1, 1).data), `${rotation}°, behind=${behind}`).toEqual([255, 0, 0, 255]);
      await task.destroy();
    }
  }
});

it("reorders using requested order and descending ranges, and preserves explicit split boundaries", async () => {
  const tools = await import("../pdfTools");
  const doc = await PDFDocument.create();
  for (const width of [100, 120, 140]) doc.addPage([width, 100]);
  const file = asFile({ name: "ordered.pdf", bytes: await doc.save() });
  const result = await PDFDocument.load((await tools.reorderPages(file, "3-2,1")).bytes);
  expect(result.getPages().map((page) => page.getWidth())).toEqual([140, 120, 100]);
  const parts = await tools.splitAtPoints(file, [0, 1]);
  expect(await Promise.all(parts.map(async (part) => (await PDFDocument.load(part.bytes)).getPageCount()))).toEqual([1, 1, 1]);
  expect(tools.parseRanges("1-999999999999", 3)).toEqual([0, 1, 2]);
});

it("fails raster transforms when a canvas is unavailable instead of returning incomplete output", async () => {
  const tools = await import("../pdfTools");
  const input = await sample();
  const create = vi.spyOn(document, "createElement").mockImplementation(() =>
    Object.assign(createCanvas(1, 1), { getContext: () => null }) as unknown as HTMLCanvasElement);
  try {
    for (const run of [tools.flattenPdf, tools.greyscalePdf, tools.invertColors, tools.sanitizePdf, tools.pdfToTiff, tools.deskewPdf])
      await expect(run(input)).rejects.toThrow(/canvas is unavailable/i);
  } finally {
    create.mockRestore();
  }
});

it("runs the catalogue's PDF, Office and data actions through real engines and validates every output", async () => {
  const tools = await import("../pdfTools");
  const { PDF_TOOLS, defaultParams } = await import("../../components/PdfToolbox");
  const pdf = asFile(await tools.mergePdfs([await sample(), await sample()]));
  const file = (text: string, name: string, type: string) => new File([text], name, { type });
  const csv = file("Name,Amount\nInvoice,42\nStock,12", "data.csv", "text/csv");
  const json = file('[{"Name":"Invoice","Amount":42}]', "data.json", "application/json");
  const form = await PDFDocument.create();
  const field = form.getForm().createTextField("Customer");
  field.addToPage(form.addPage());
  const formFile = asFile({ name: "form.pdf", bytes: await form.save() });
  const bookmarked = asFile(await tools.setBookmarks(pdf, "Invoice | 1\n  Detail | 2"));
  const attached = asFile(await tools.addAttachments([pdf, csv]));
  const encrypted = asFile(await tools.encryptPdf(pdf, { userPassword: "test-password" }));
  const officeFile = (out: OutFile) => new File([out.bytes.slice()], out.name);
  const word = officeFile(await tools.pdfToDocx(pdf));
  const excel = officeFile(await tools.pdfToExcel(pdf));
  const PPTX = (await import("pptxgenjs")).default;
  const deck = new PPTX();
  deck.addSlide().addText("Invoice 42", { x: 1, y: 1, w: 5, h: 1 });
  const pptx = new File([await deck.write({ outputType: "arraybuffer" }) as ArrayBuffer], "slides.pptx");
  const tiff = officeFile((await tools.pdfToTiff(pdf))[0]);
  const raster = createCanvas(120, 80);
  const rasterContext = raster.getContext("2d");
  rasterContext.fillStyle = "#FFD21A";
  rasterContext.fillRect(0, 0, 120, 80);
  rasterContext.fillStyle = "#111111";
  rasterContext.fillRect(20, 20, 40, 40);
  const png = new File([new Uint8Array(raster.toBuffer("image/png"))], "image.png", { type: "image/png" });
  const jpeg = new File([new Uint8Array(raster.toBuffer("image/jpeg"))], "image.jpg", { type: "image/jpeg" });
  const imagePdf = asFile(await tools.imagesToPdf([png]));
  const scan = createCanvas(500, 180);
  const scanContext = scan.getContext("2d");
  scanContext.fillStyle = "#ffffff";
  scanContext.fillRect(0, 0, 500, 180);
  scanContext.fillStyle = "#111111";
  scanContext.font = "36px sans-serif";
  scanContext.fillText("FILEY INVOICE 42", 30, 95);
  const scanPdf = asFile(await tools.imagesToPdf([
    new File([new Uint8Array(scan.toBuffer("image/png"))], "scan.png", { type: "image/png" }),
  ]));
  const archive = new JSZip();
  archive.file("page-01.png", await png.arrayBuffer());
  archive.file("page-02.jpg", await jpeg.arrayBuffer());
  const cbz = new File([new Uint8Array(await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" }))], "comic.cbz");
  const { initializeCanvas, writePsd } = await import("ag-psd");
  initializeCanvas((width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement);
  const psd = new File([writePsd({ width: 120, height: 80, canvas: raster as unknown as HTMLCanvasElement })], "image.psd");
  const inputs: Record<string, File[]> = {
    merge: [pdf, pdf], alternate: [pdf, pdf], compare: [pdf, await sample()],
    txt2pdf: [file("Invoice 42", "notes.txt", "text/plain")],
    csv2pdf: [csv], csv2json: [csv], json2csv: [json], json2pdf: [json],
    md2pdf: [file("# Invoice\n42", "notes.md", "text/markdown")],
    word2pdf: [word], excel2pdf: [excel], ppt2pdf: [pptx], tiff2pdf: [tiff],
    rtf2pdf: [file("{\\rtf1 Invoice 42\\par Details}", "notes.rtf", "application/rtf")],
    "add-attach": [pdf, csv], "extract-attach": [attached],
    "extract-bookmarks": [bookmarked], "list-fields": [formFile], "fill-form": [formFile],
    "flatten-form": [formFile], decrypt: [encrypted],
    img2pdf: [png, jpeg], "img-compress": [png], img2svg: [png], "extract-images": [imagePdf],
    svg2img: [file('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#FFD21A"/></svg>', "image.svg", "image/svg+xml")],
    cbz2pdf: [cbz], "psd-to-pdf": [psd],
    "ocr-pdf": [scanPdf], "ocr-text": [scanPdf],
  };
  const params: Record<string, Record<string, string>> = {
    "split-at": { points: "2" }, bookmarks: { spec: "Invoice | 1\n  Detail | 2" },
    encrypt: { userPassword: "test-password" }, permissions: { ownerPassword: "test-owner" },
    decrypt: { password: "test-password" }, "fill-form": { data: '{"Customer":"Filey"}' },
  };
  // These require a browser image decoder, wasm or their interactive editor.
  // Interactive page operations are covered directly by pdftools-smoke.
  const browserOnly = new Set(["heic-to-pdf"]);
  const cases = PDF_TOOLS.filter((tool) => (!tool.interactive || tool.headlessOk || tool.id === "fill-form") && !browserOnly.has(tool.id));
  const failures: string[] = [];
  for (const tool of cases) {
    try {
      const results = await tool.run(inputs[tool.id] ?? [pdf], { ...defaultParams(tool), ...params[tool.id] });
      expect(results.length, tool.id).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.bytes.length, tool.id).toBeGreaterThan(0);
        if (result.name.endsWith(".pdf") && !["encrypt", "permissions"].includes(tool.id)) {
          const parsed = await PDFDocument.load(result.bytes);
          expect(parsed.getPageCount(), tool.id).toBeGreaterThan(0);
        } else if (/\.(docx|xlsx|pptx|zip)$/.test(result.name)) {
          const zip = await JSZip.loadAsync(result.bytes);
          expect(Object.keys(zip.files).length, tool.id).toBeGreaterThan(0);
        }
        if (tool.id === "ocr-text")
          expect(new TextDecoder().decode(result.bytes)).toContain("INVOICE 42");
        if (tool.id === "ocr-pdf")
          expect(new TextDecoder().decode((await tools.pdfToText(asFile(result))).bytes)).toContain("INVOICE 42");
      }
    } catch (error) {
      failures.push(`${tool.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(cases.length).toBeGreaterThan(60);
  expect(failures).toEqual([]);
}, 30_000);
