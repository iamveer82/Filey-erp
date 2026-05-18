import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders the invoice "paper" at its true size: zoom = 100 ⇒ the page
 * at native A4 scale (never shrunk to fit the column); the zoom control
 * multiplies on top. The container scrolls both axes when the sheet is
 * larger than the available area. Reserves correctly-sized layout space
 * for the transform-scaled sheet so scrollbars track the real size.
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
  const [contentH, setContentH] = useState(1075);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  const scale = Math.max(0.2, zoom / 100);

  return (
    <div className="bg-brand-100 rounded-xl p-4 overflow-auto max-h-[70vh]">
      <div
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
            minHeight: 1075,
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
