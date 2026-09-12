import { useEffect, useRef, useState, type ReactNode } from "react";

/** A4 portrait at 96dpi: 210mm × 297mm = 794 × 1123 px (ratio 1:√2). */
const A4_RATIO = 297 / 210; // ≈ 1.4142

/**
 * Renders the invoice/quote "paper" at true A4 portrait dimensions, then
 * scales it to fit the available panel width so it sits neatly inside its
 * column.
 *
 * Scale down (fit to panel): uses `transform: scale()` — the content renders
 * at full native resolution (crisp text, whole-pixel borders) and the GPU
 * handles the downscale. This avoids the sub-pixel blur that CSS `zoom`
 * produces at low zoom levels (thin borders become 0.4px, text anti-aliases
 * poorly).
 *
 * Scale up (zoom in): uses CSS `zoom` so the browser re-layouts at the
 * larger size — crisper than bitmap-scaling a full-size render.
 *
 * Note: the inline `transform` and `zoom` are reset for PDF capture
 * (lib/pdfTools) and print (index.css `@media print`) so exports always
 * render at native A4.
 */
export default function FitPreview({
  baseWidth,
  zoom,
  padding = 48,
  children,
}: {
  baseWidth: number;
  zoom: number;
  /** Inner sheet padding in px. Pass 0 for full-bleed content (letterheads). */
  padding?: number;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const a4Height = Math.round(baseWidth * A4_RATIO);
  const [fitW, setFitW] = useState(baseWidth);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const measure = () => {
      const avail = box.clientWidth - 32; // p-4 on each side
      if (avail > 0) setFitW(avail);
    };
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    scheduleMeasure();

    // Panel dragging and sidebar changes resize the paper without resizing the
    // window. Only the available width changes the fit; height-only updates bail out.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
    observer?.observe(box);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

  // Shrink the A4 sheet to the panel width (never enlarge past 1:1), then
  // apply the user's zoom on top of that fit.
  const fitScale = Math.min(1, fitW / baseWidth);
  const scale = Math.max(0.2, fitScale * (zoom / 100));

  return (
    <div
      ref={boxRef}
      className="fp-box bg-brand-100 rounded-xl p-4 overflow-y-auto overflow-x-hidden max-h-[85vh] [scrollbar-gutter:stable]"
    >
      {scale <= 0.98 ? (
        /* Scale down: render at full resolution, then GPU-scale to fit.
           Text/borders render crisp at native size; GPU handles downscale.
           Viewport clips overflow so layout stays at the scaled dimensions. */
        <div
          className="mx-auto"
          style={{
            width: Math.round(baseWidth * scale),
            height: Math.round(a4Height * scale),
            overflow: "hidden",
          }}
        >
          <div
            className="invoice-print bg-white"
            style={{
              width: baseWidth,
              minHeight: a4Height,
              padding,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      ) : (
        /* Scale up (zoom in): use CSS zoom so browser re-layouts at the
           larger size - crisper than bitmap-scaling a full-size render.
           Overflow on fp-box enables scrolling when zoomed past 100%. */
        <div
          className="invoice-print bg-white mx-auto"
          style={{
            width: baseWidth,
            minHeight: a4Height,
            padding,
            zoom: scale,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
