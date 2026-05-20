import { useEffect, useRef, useState, type ReactNode } from "react";

/** A4 portrait at 96dpi: 210mm × 297mm = 794 × 1123 px (ratio 1:√2). */
const A4_RATIO = 297 / 210; // ≈ 1.4142

/**
 * Renders the invoice "paper" at true A4 portrait dimensions:
 * the sheet is always sized to A4 (baseWidth × baseWidth·√2) and is
 * scaled via transform by the zoom control. The container reserves
 * the correct layout space for the scaled sheet and scrolls when the
 * page outgrows it.
 */
export default function FitPreview({
  baseWidth,
  zoom,
  children,
}: {
  baseWidth: number;
  zoom: number;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const a4Height = Math.round(baseWidth * A4_RATIO);
  const [contentH, setContentH] = useState(a4Height);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () =>
      setContentH(Math.max(a4Height, el.scrollHeight));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  const scale = Math.max(0.2, zoom / 100);

  return (
    <div className="fp-box bg-brand-100 rounded-xl p-4 overflow-auto max-h-[70vh]">
      <div
        className="fp-frame"
        style={{
          width: baseWidth * scale,
          height: contentH * scale,
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div
          ref={sheetRef}
          className="invoice-print bg-white shadow-bento"
          style={{
            width: baseWidth,
            minHeight: a4Height,
            padding: 48,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
