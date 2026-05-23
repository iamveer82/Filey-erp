// Shared text measurement + canvas rendering, powered by pretext
// (@chenglou/pretext). Use this wherever text is placed on a <canvas> or
// embedded into a PDF/image and you need exact, reflow-free measurement:
// typed signatures, stamp labels, watermark-as-image, the Edit/Sign-PDF
// text overlay, canvas previews.
//
// NOTE: for text drawn *by pdf-lib* (drawText), use pdf-lib's own
// `font.widthOfTextAtSize()` — same font engine, more accurate there.
// pretext shines for canvas/SVG text and HTML-font measurement.
import {
  prepareWithSegments,
  layoutWithLines,
  measureNaturalWidth,
  type PrepareOptions,
} from "@chenglou/pretext";

export interface TextBlock {
  width: number;
  height: number;
  lineCount: number;
  lines: { text: string; width: number }[];
}

/** Natural single-line width of `text` in a CSS `font`
 *  (e.g. `"600 16px 'Plus Jakarta Sans'"`). No DOM reflow. */
export function measureTextWidth(
  text: string,
  font: string,
  options?: PrepareOptions
): number {
  return measureNaturalWidth(prepareWithSegments(text, font, options));
}

/** Wrap `text` to `maxWidth` and report the laid-out lines + box size. */
export function measureTextBlock(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
  options?: PrepareOptions
): TextBlock {
  const prepared = prepareWithSegments(text, font, options);
  const res = layoutWithLines(prepared, maxWidth, lineHeight);
  const width = res.lines.reduce((m, l) => Math.max(m, l.width), 0);
  return {
    width,
    height: res.height,
    lineCount: res.lineCount,
    lines: res.lines.map((l) => ({ text: l.text, width: l.width })),
  };
}

export interface RenderTextOptions {
  /** CSS font shorthand, e.g. "600 28px 'Plus Jakarta Sans'". */
  font: string;
  color?: string;
  /** Wrap width in px; omit for a single line shrink-wrapped to content. */
  maxWidth?: number;
  /** Line height in px; defaults to ~1.3× the font px size. */
  lineHeight?: number;
  padding?: number;
  align?: "left" | "center" | "right";
  /** Optional background fill (default: transparent — good for overlays). */
  background?: string;
  /** Pixel-density multiplier for crisp output (default 2). */
  scale?: number;
}

/** Render measured, wrapped text onto a tightly-sized canvas. The canvas
 *  dimensions come from pretext, so it wraps exactly to the content —
 *  ideal for embedding into a PDF via pdf-lib `embedPng`. */
export function renderTextToCanvas(
  text: string,
  opts: RenderTextOptions
): HTMLCanvasElement {
  const {
    font,
    color = "#0A0A0A",
    padding = 0,
    align = "left",
    background,
    scale = 2,
  } = opts;
  const lineHeight = opts.lineHeight ?? Math.round(fontPx(font) * 1.3);

  const block: TextBlock =
    opts.maxWidth != null
      ? measureTextBlock(text, font, opts.maxWidth, lineHeight)
      : (() => {
          const w = measureTextWidth(text, font);
          return {
            width: w,
            height: lineHeight,
            lineCount: 1,
            lines: [{ text, width: w }],
          };
        })();

  const cw = Math.ceil(block.width + padding * 2);
  const ch = Math.ceil(block.height + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, cw * scale);
  canvas.height = Math.max(1, ch * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.scale(scale, scale);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  block.lines.forEach((line, i) => {
    let x = padding;
    if (align === "center") x = padding + (block.width - line.width) / 2;
    else if (align === "right") x = padding + (block.width - line.width);
    ctx.fillText(line.text, x, padding + i * lineHeight);
  });
  return canvas;
}

/** Render text to a PNG data URL (transparent by default). */
export function renderTextToDataUrl(
  text: string,
  opts: RenderTextOptions
): string {
  return renderTextToCanvas(text, opts).toDataURL("image/png");
}

/** Pull the px size out of a CSS font shorthand ("600 16px Inter" -> 16). */
function fontPx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : 16;
}
