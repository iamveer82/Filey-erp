import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders a fixed-width "paper" preview scaled to always fit the
 * available column width (zoom = 100 ⇒ fit-to-width; the zoom control
 * multiplies on top). Reserves correctly-sized layout space so the
 * scaled sheet neither overflows horizontally nor leaves a gap.
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
  const boxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(baseWidth);
  const [contentH, setContentH] = useState(1040);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setAvail(Math.max(0, el.clientWidth - 32));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  const fit = avail > 0 ? avail / baseWidth : 1;
  const scale = Math.max(0.2, fit * (zoom / 100));

  return (
    <div
      ref={boxRef}
      className="bg-brand-100 rounded-xl p-4 overflow-auto max-h-[70vh]"
    >
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
            minHeight: 1040,
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
