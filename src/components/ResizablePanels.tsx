import { useState, useRef, useCallback, useEffect, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  rightTitle?: string;
  defaultRightWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
  collapsedWidth?: number;
  defaultCollapsed?: boolean;
}

/** Two-pane editor layout used across document builders.
 *  - Left pane (form/items) grows to fit wide tables.
 *  - Right pane (preview) can be dragged, collapsed to a strip, or expanded.
 *  - Collapsing gives the editor the full remaining width. */
export function ResizablePanels({
  left,
  right,
  rightTitle = "Preview",
  defaultRightWidth = 360,
  minRightWidth = 240,
  maxRightWidth = 520,
  collapsedWidth = 48,
  defaultCollapsed = false,
}: ResizablePanelsProps) {
  const [width, setWidth] = useState(defaultCollapsed ? collapsedWidth : defaultRightWidth);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const delta = startXRef.current - e.clientX;
      const next = Math.max(minRightWidth, Math.min(maxRightWidth, startWidthRef.current + delta));
      setWidth(next);
      if (next > collapsedWidth + 20) setCollapsed(false);
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, collapsedWidth, minRightWidth, maxRightWidth]);

  const toggle = () => {
    if (collapsed) {
      setCollapsed(false);
      setWidth(defaultRightWidth);
    } else {
      setCollapsed(true);
      setWidth(collapsedWidth);
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col xl:flex-row items-start gap-4 w-full min-w-0">
      <div className="w-full xl:flex-1 min-w-0 overflow-hidden">{left}</div>
      <div
        className="relative w-full xl:w-[var(--preview-width)] shrink-0 motion-safe:transition-[width] duration-200 ease-out"
        style={{ "--preview-width": `${collapsed ? collapsedWidth : width}px` } as CSSProperties}
      >
        {/* Drag handle */}
        <button
          onMouseDown={onMouseDown}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setCollapsed(false);
            setWidth((w) => Math.max(minRightWidth, Math.min(maxRightWidth, w + (e.key === "ArrowLeft" ? 20 : -20))));
          }}
          className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 hidden xl:grid place-items-center w-5 h-12 rounded-full border border-brand-200 bg-white text-brand-400 hover:text-ink hover:border-brand-400 cursor-col-resize shadow-sm"
          title="Drag to resize preview"
          aria-label="Drag to resize preview"
        >
          <GripVertical size={12} />
        </button>

        {/* Collapse / expand toggle */}
        <button
          onClick={toggle}
          className="btn-ghost absolute top-2 right-2 z-20 h-10 w-10 p-0"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand preview" : "Minimize preview"}
          title={collapsed ? "Expand preview" : "Minimize preview"}
        >
          {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {collapsed && (
          <div className="h-full min-h-14 xl:min-h-[120px] rounded-xl border border-brand-200 bg-brand-50/30 dark:bg-white/[0.02] flex flex-col items-center justify-center gap-2 py-4 xl:pt-14">
            <span className="text-xs font-medium text-brand-500 xl:[writing-mode:vertical-rl]">{rightTitle}</span>
          </div>
        )}
        <div
          aria-hidden={collapsed || undefined}
          inert={collapsed || undefined}
          className={collapsed ? "fixed left-[-99999px] top-0 pointer-events-none" : undefined}
          style={collapsed ? { width: defaultRightWidth } : undefined}
        >
          {right}
        </div>
      </div>
    </div>
  );
}
