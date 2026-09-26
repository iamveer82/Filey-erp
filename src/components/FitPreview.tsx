import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

/** A4 portrait at 96dpi: 210mm × 297mm = 794 × 1123 px (ratio 1:√2). */
const A4_RATIO = 297 / 210; // ≈ 1.4142

/** Below this the A4 body type stops being readable (11px × 0.5 ≈ 5px). A phone
 *  in portrait fits ~47% of the sheet, which is why the default there is to
 *  open at a legible zoom and let the reader pan, rather than showing a whole
 *  page of unreadable text. "Fit width" stays one tap away. */
const LEGIBLE_SCALE = 0.8;

/** The reading zoom that makes `fitScale` legible. A wide desktop panel is
 *  already at 1:1 and is left alone. */
const legibleZoom = (fitScale: number) =>
  fitScale >= LEGIBLE_SCALE
    ? 100
    : Math.min(250, Math.ceil((LEGIBLE_SCALE / fitScale) * 100));

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
  zoomable = false,
  children,
}: {
  baseWidth: number;
  zoom: number;
  /** Inner sheet padding in px. Pass 0 for full-bleed content (letterheads). */
  padding?: number;
  /** Reading controls for document dialogs; editor zoom stays externally owned. */
  zoomable?: boolean;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const a4Height = Math.round(baseWidth * A4_RATIO);
  const [fitW, setFitW] = useState(baseWidth);
  // null = "not chosen yet", so the first legible zoom follows the measured
  // panel instead of being frozen at fit-width on a phone. Any explicit press
  // of Fit width / - / + takes over from here.
  const [readingZoom, setReadingZoom] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const measure = () => {
      const styles = getComputedStyle(box);
      const inset = (parseFloat(styles.paddingLeft) || 16) + (parseFloat(styles.paddingRight) || 16);
      const avail = box.clientWidth - inset;
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
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleMeasure);
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
  // The reading viewer opens legible on a narrow panel; the editor keeps the
  // zoom its owner passed in.
  const shownZoom = zoomable ? readingZoom ?? legibleZoom(fitScale) : zoom;
  const scale = Math.max(0.2, fitScale * (shownZoom / 100));
  const atFitWidth = shownZoom === 100;

  return (
    <>
      {zoomable && (
        <div
          className="mb-3 flex items-center gap-2"
          role="group"
          aria-label="Document zoom"
        >
          <button
            type="button"
            className="btn-ghost min-h-11"
            onClick={() => setReadingZoom(100)}
            aria-pressed={atFitWidth}
          >
            Fit width
          </button>
          <button
            type="button"
            className="btn-ghost min-h-11 w-11 p-0"
            aria-label="Zoom out on document"
            disabled={atFitWidth}
            onClick={() => setReadingZoom((value) => Math.max(100, (value ?? legibleZoom(fitScale)) - 50))}
          >
            <Minus size={16} />
          </button>
          <output
            className="min-w-10 text-center text-xs tabular-nums text-muted-foreground"
            aria-label="Document zoom level"
          >
            {shownZoom}%
          </output>
          <button
            type="button"
            className="btn-ghost min-h-11 w-11 p-0"
            aria-label="Zoom in on document"
            disabled={shownZoom >= 400}
            onClick={() => setReadingZoom((value) => Math.min(400, (value ?? legibleZoom(fitScale)) + 50))}
          >
            <Plus size={16} />
          </button>
        </div>
      )}
      <div
        ref={boxRef}
        className="fp-box min-w-0 bg-brand-100 rounded-xl p-4 overflow-auto max-h-[85dvh] [scrollbar-gutter:stable]"
        role={zoomable ? "region" : undefined}
        aria-label={zoomable ? "Document page" : undefined}
        tabIndex={zoomable ? 0 : undefined}
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
    </>
  );
}
