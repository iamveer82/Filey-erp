import { useRef, useState, useLayoutEffect } from "react";
import { measureTextWidth } from "../lib/textLayout";

/* Auto-scaling text: measures the natural width with pretext and shrinks the
 * font just enough to fit the container, so values stay readable at any widget
 * size (no clipping). Scales back up to basePx when there's room. */

export default function FitText({
  children,
  basePx = 24,
  minPx = 12,
  weight = 700,
  className,
}: {
  children: string | number;
  basePx?: number;
  minPx?: number;
  weight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(basePx);
  const text = String(children);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      const natural = measureTextWidth(text, `${weight} ${basePx}px 'Plus Jakarta Sans'`);
      setPx(natural > avail ? Math.max(minPx, (avail / natural) * basePx) : basePx);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, basePx, minPx, weight]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ fontSize: `${px}px`, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden" }}
    >
      {text}
    </div>
  );
}
