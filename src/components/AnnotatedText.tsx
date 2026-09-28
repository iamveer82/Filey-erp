import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/format";
import "./AnnotatedText.css";

// Precomputed from the supplied seeded marks (17, 23, 163), so rendering needs no random geometry.
const marks = {
  wavy: { viewBox: "0 0 140 14", path: "M2,6.82 Q5.78,10.22 7.67,8.6 Q9.56,6.97 11.44,5.41 Q13.33,3.86 15.22,5.5 Q17.11,7.15 19,8.52 Q20.89,9.88 22.78,8.5 Q24.67,7.12 26.56,5.46 Q28.44,3.8 30.33,5.28 Q32.22,6.76 34.11,8.4 Q36,10.04 37.89,8.52 Q39.78,7.01 41.67,5.46 Q43.56,3.92 45.44,5.36 Q47.33,6.8 49.22,8.25 Q51.11,9.7 53,8.48 Q54.89,7.27 56.78,5.61 Q58.67,3.96 60.56,5.41 Q62.44,6.87 64.33,8.46 Q66.22,10.05 68.11,8.51 Q70,6.97 71.89,5.56 Q73.78,4.15 75.67,5.5 Q77.56,6.84 79.44,8.28 Q81.33,9.73 83.22,8.47 Q85.11,7.21 87,5.59 Q88.89,3.98 90.78,5.32 Q92.67,6.66 94.56,8.42 Q96.44,10.19 98.33,8.48 Q100.22,6.77 102.11,5.44 Q104,4.11 105.89,5.46 Q107.78,6.8 109.67,8.45 Q111.56,10.09 113.44,8.49 Q115.33,6.88 117.22,5.5 Q119.11,4.11 121,5.64 Q122.89,7.17 124.78,8.65 Q126.67,10.13 128.56,8.65 Q130.44,7.17 132.33,5.52 Q134.22,3.87 136.11,5.32 L138,6.77" },
  underline: { viewBox: "0 0 140 10", path: "M3,6 Q14.24,5.42 19.9,5.3 Q25.57,5.18 30.9,4.88 Q36.23,4.57 41.79,4.47 Q47.35,4.38 52.94,4.01 Q58.54,3.64 64.04,3.72 Q69.54,3.8 75.22,3.5 Q80.9,3.19 86.47,3.49 Q92.04,3.78 97.63,3.55 Q103.23,3.33 108.9,3.74 Q114.58,4.15 120.38,4.58 Q126.18,5 131.59,5 L137,5" },
  highlight: { viewBox: "0 0 170 26", path: "M5,6 Q20.92,5.5 28.69,5.06 Q36.47,4.62 44.79,4.61 Q53.11,4.6 61.02,4.4 Q68.92,4.19 77.1,3.77 Q85.28,3.35 93.33,3.17 Q101.38,2.98 109.04,3.33 Q116.7,3.67 124.94,4.01 Q133.19,4.34 140.85,4.24 Q148.51,4.14 156.75,4.57 Q165,5 165,5 Q165,5 164.81,7.55 Q164.61,10.09 164.9,12.96 Q165.19,15.83 165.1,18.41 Q165,21 165,21 Q165,21 156.94,21.2 Q148.88,21.41 141.08,21.64 Q133.29,21.86 125,22.2 Q116.7,22.54 108.81,22.89 Q100.92,23.24 93.03,23.15 Q85.14,23.05 77.24,23.3 Q69.34,23.54 61.18,23.17 Q53.03,22.79 45.18,22.81 Q37.33,22.83 29.36,22.53 Q21.38,22.23 13.19,22.11 Q5,22 5,22 Q5,22 4.87,19.41 Q4.73,16.81 5,14.07 Q5.27,11.33 5.13,8.67 L5,6 Z" },
};

export function AnnotatedText({ children, variant = "underline", animate = true, className }: {
  children: ReactNode;
  variant?: keyof typeof marks;
  animate?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGPathElement>(null);
  const filled = variant === "highlight";

  useEffect(() => {
    const drawing = ref.current;
    if (!animate || !drawing?.animate || typeof IntersectionObserver === "undefined" || typeof matchMedia === "undefined") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const animation = drawing.animate(
      filled
        ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }]
        : [
            { strokeDasharray: "1", strokeDashoffset: "1", opacity: 0, offset: 0 },
            { strokeDasharray: "1", strokeDashoffset: ".999", opacity: 1, offset: .001 },
            { strokeDasharray: "1", strokeDashoffset: "0", opacity: 1, offset: 1 },
          ],
      { duration: 550, easing: "cubic-bezier(.22,.61,.36,1)", fill: "backwards" },
    );
    animation.pause();
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        animation.play();
        observer.disconnect();
      }
    }, { threshold: .25 });
    observer.observe(drawing.closest("span")!);
    const stop = () => {
      if (reduced.matches) { observer.disconnect(); animation.cancel(); }
    };
    reduced.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animation.cancel();
      reduced.removeEventListener("change", stop);
    };
  }, [animate, filled, variant]);

  return <span className={cn("filey-annotated-text", className)} data-mark={variant}>
    <span className="filey-annotated-words">{children}</span>
    <svg viewBox={marks[variant].viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path ref={ref} d={marks[variant].path} pathLength={1}
        fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"}
        strokeWidth={variant === "wavy" ? 2.2 : 2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}
