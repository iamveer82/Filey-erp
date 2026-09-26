import { PDFDocument, StandardFonts, degrees, rgb, LineCapStyle } from "pdf-lib";

export type Point = { x: number; y: number };
export type Annotation = { id: string; page: number; color: string } & (
  | { kind: "ink"; points: Point[]; width: number }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      bold: boolean;
      family: "Sans" | "Serif" | "Mono";
    }
  | { kind: "highlight" | "rect"; x: number; y: number; w: number; h: number }
);
export type PageChange = {
  rotation?: number;
  deleted?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
};

/** Coordinates use the visible page's PDF points, independent of screen size or zoom. */
export async function savePdfAnnotations(
  file: File,
  annotations: Annotation[],
  changes: Record<number, PageChange>
): Promise<File> {
  const doc = await PDFDocument.load(await file.arrayBuffer());
  const pages = doc.getPages();
  if (pages.every((_, i) => changes[i]?.deleted))
    throw new Error("Keep at least one page in your PDF.");
  for (const [index, page] of pages.entries()) {
    if (changes[index]?.deleted) continue;
    const crop = page.getCropBox();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const quarter = angle === 90 || angle === 270;
    const width = quarter ? crop.height : crop.width;
    const height = quarter ? crop.width : crop.height;
    const marks = annotations.filter((mark) => mark.page === index);
    if (marks.length) {
      // One vector overlay keeps text searchable and maps all marks through the
      // same inverse crop/rotation transform used by the document viewer.
      const overlay = await PDFDocument.create();
      const sheet = overlay.addPage([width, height]);
      for (const mark of marks) {
        const n = parseInt(mark.color.replace("#", ""), 16);
        const color = rgb(
          ((n >> 16) & 255) / 255,
          ((n >> 8) & 255) / 255,
          (n & 255) / 255
        );
        if (mark.kind === "ink") {
          if (mark.points.length === 1)
            sheet.drawCircle({
              x: mark.points[0].x,
              y: height - mark.points[0].y,
              size: mark.width / 2,
              color,
            });
          for (let k = 1; k < mark.points.length; k++)
            sheet.drawLine({
              start: { x: mark.points[k - 1].x, y: height - mark.points[k - 1].y },
              end: { x: mark.points[k].x, y: height - mark.points[k].y },
              color,
              thickness: mark.width,
              lineCap: LineCapStyle.Round,
            });
        } else if (mark.kind === "text") {
          const fontName =
            mark.family === "Serif"
              ? mark.bold
                ? StandardFonts.TimesRomanBold
                : StandardFonts.TimesRoman
              : mark.family === "Mono"
                ? mark.bold
                  ? StandardFonts.CourierBold
                  : StandardFonts.Courier
                : mark.bold
                  ? StandardFonts.HelveticaBold
                  : StandardFonts.Helvetica;
          const font = await overlay.embedFont(fontName);
          sheet.drawText(mark.text, {
            x: mark.x,
            y: height - mark.y - mark.size,
            size: mark.size,
            lineHeight: mark.size * 1.25,
            font,
            color,
          });
        } else
          sheet.drawRectangle({
            x: mark.x,
            y: height - mark.y - mark.h,
            width: mark.w,
            height: mark.h,
            ...(mark.kind === "highlight"
              ? { color, opacity: 0.35, borderWidth: 0 }
              : { borderColor: color, borderWidth: 1.5 }),
          });
      }
      const [embedded] = await doc.embedPdf(await overlay.save());
      page.drawPage(embedded, {
        x: crop.x + (angle === 90 || angle === 180 ? crop.width : 0),
        y: crop.y + (angle === 180 || angle === 270 ? crop.height : 0),
        width,
        height,
        rotate: degrees(angle),
      });
    }
    const cut = changes[index]?.crop;
    if (cut) {
      const toPdf = (x: number, y: number): Point =>
        angle === 90
          ? { x: crop.x + y, y: crop.y + x }
          : angle === 180
            ? { x: crop.x + crop.width - x, y: crop.y + y }
            : angle === 270
              ? { x: crop.x + crop.width - y, y: crop.y + crop.height - x }
              : { x: crop.x + x, y: crop.y + crop.height - y };
      const a = toPdf(cut.x, cut.y),
        b = toPdf(cut.x + cut.w, cut.y + cut.h);
      page.setCropBox(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y)
      );
    }
    page.setRotation(degrees((angle + (changes[index]?.rotation || 0)) % 360));
  }
  for (let i = pages.length - 1; i >= 0; i--) if (changes[i]?.deleted) doc.removePage(i);
  return new File(
    [new Uint8Array(await doc.save())],
    file.name.replace(/\.pdf$/i, "") + "-edited.pdf",
    { type: "application/pdf" }
  );
}
