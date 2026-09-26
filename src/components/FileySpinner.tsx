import type { SVGProps } from "react";

/** A paper-thin track and a rounded moving arc, shared by every busy action. */
export function FileySpinner({ size = 18, className = "", ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
    className={`filey-spinner shrink-0 ${className.replace(/\b(?:motion-safe:)?animate-spin\b/g, "")}`} {...props}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.16" />
    <g className="filey-spinner-arc">
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="21" r="1.25" fill="currentColor" opacity="0.45" />
    </g>
  </svg>;
}
