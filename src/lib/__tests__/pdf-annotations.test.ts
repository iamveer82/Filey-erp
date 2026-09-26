// @vitest-environment node
import { expect, it, vi, afterAll } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { createCanvas, Path2D, DOMMatrix, ImageData } from "@napi-rs/canvas";
import { savePdfAnnotations, type Annotation } from "../pdfAnnotations";

vi.stubGlobal("Path2D", Path2D);
vi.stubGlobal("DOMMatrix", DOMMatrix);
vi.stubGlobal("ImageData", ImageData);
afterAll(() => vi.unstubAllGlobals());

it("exports brush and text in the same visible location on cropped, rotated pages", async () => {
  const source = await PDFDocument.create();
  const marks: Annotation[] = [];
  for (let i = 0; i < 4; i++) {
    const page = source.addPage([300, 400]);
    page.setCropBox(30, 40, 200, 300);
    page.setRotation(degrees(i * 90));
    page.drawRectangle({ x: 30, y: 40, width: 10, height: 10, color: rgb(0, 0, 0) });
    marks.push({
      id: `ink-${i}`,
      page: i,
      kind: "ink",
      points: [
        { x: 20, y: 40 },
        { x: 70, y: 40 },
      ],
      width: 8,
      color: "#172b4d",
    });
    marks.push({
      id: `text-${i}`,
      page: i,
      kind: "text",
      x: 20,
      y: 80,
      text: "Reviewed",
      size: 14,
      color: "#172b4d",
      bold: false,
      family: "Sans",
    });
  }
  const original = new Uint8Array(await source.save());
  const file = new File([original], "sample.pdf", { type: "application/pdf" });
  const saved = await savePdfAnnotations(file, marks, {});
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(original);
  const require = createRequire(import.meta.url);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
  ).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await saved.arrayBuffer()),
    useSystemFonts: true,
  });
  const document = await task.promise;
  try {
    for (let i = 1; i <= 4; i++) {
      const page = await document.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      expect(
        Array.from(ctx.getImageData(45, 40, 1, 1).data),
        `rotation ${(i - 1) * 90}`
      ).toEqual([23, 43, 77, 255]);
      expect(
        (await page.getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join("")
      ).toContain("Reviewed");
    }
  } finally {
    await task.destroy();
  }
});

it("saves page rotation and crop, preserves other pages, and refuses an empty PDF", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  doc.addPage([400, 250]);
  const file = new File([new Uint8Array(await doc.save())], "pages.pdf");
  const result = await savePdfAnnotations(file, [], {
    0: { rotation: 90, crop: { x: 10, y: 20, w: 100, h: 120 } },
  });
  const saved = await PDFDocument.load(await result.arrayBuffer());
  expect(saved.getPage(0).getRotation().angle).toBe(90);
  expect(saved.getPage(0).getCropBox()).toEqual({
    x: 10,
    y: 160,
    width: 100,
    height: 120,
  });
  expect(saved.getPage(1).getSize()).toEqual({ width: 400, height: 250 });
  await expect(
    savePdfAnnotations(file, [], { 0: { deleted: true }, 1: { deleted: true } })
  ).rejects.toThrow("Keep at least one page");
});
