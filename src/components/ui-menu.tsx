import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/format";

/* ── ui-menu — the one dropdown-menu primitive for the whole app ─────
 * Matches the composer "+" menu pattern: a fixed, anchor-positioned
 * panel (portal — never clipped by tables/overlays) with rows of
 * [icon] label [hint | chevron | check], hairline separators between
 * groups, and outside-click + Escape dismissal.
 *
 * Token contract (design.md): bg-card border-border rounded-xl shadow-lg
 * p-1; rows h-9 rounded-md hover:bg-hover text-[13px]; muted w-4 icons;
 * check = primary-600 dark:primary-400.
 *
 * Rendered through a portal with fixed coordinates measured off the
 * anchor (same approach RowActions proven out for WebView2, which
 * composites absolute menus into a scrolling ancestor's layer and then
 * partially repaints them). */

/** Anchored menu panel. Give it the open flag, a close callback and a ref to
 *  the trigger element; it handles positioning, dismissal and portal mounting. */
export function MenuPopover({
  open,
  onClose,
  anchorRef,
  side = "bottom",
  align = "start",
  closeOnScroll = false,
  className,
  style,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The trigger element the panel anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Open upward (composer-style) or downward (toolbar-style). */
  side?: "top" | "bottom";
  align?: "end" | "start";
  /** Tables scroll under their menus — close instead of following. */
  closeOnScroll?: boolean;
  className?: string;
  /** Extra inline styles merged over the computed position (e.g. minWidth). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  // Keep handlers stable so listeners subscribe once per open/close.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        closeRef.current();
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const w = panelRef.current?.offsetWidth ?? 0;
      const h = panelRef.current?.offsetHeight ?? 0;
      // The caller's side is only a preference: flip when the panel would
      // spill past the viewport edge, so a select at the bottom of a form
      // (or the top of one, for composer-style menus) stays fully on screen.
      let effSide = side;
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      if (side === "bottom" && below < h + gap && above > below) effSide = "top";
      else if (side === "top" && above < h + gap && below > above)
        effSide = "bottom";
      const rawLeft = align === "end" ? r.right - w : r.left;
      setPos({
        position: "fixed",
        top: effSide === "top" ? r.top - gap : r.bottom + gap,
        transform: effSide === "top" ? "translateY(-100%)" : undefined,
        left: Math.max(8, Math.min(rawLeft, window.innerWidth - w - 8)),
      });
    };
    place();
    // Height isn't known until after paint (fonts, option count) — re-measure
    // once so the flip decision uses the real panel size.
    const raf = requestAnimationFrame(place);
    const onScroll = () => {
      if (closeOnScroll) closeRef.current();
      else place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, side, align, closeOnScroll]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{ ...pos, ...style }}
      className={cn(
        "z-50 rounded-xl border border-border bg-card p-1 shadow-lg",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}

/** One menu row: icon · label · trailing hint / chevron / check. One shape for
 *  every row so scanning is horizontal only. */
export function MenuItemRow({
  icon,
  label,
  hint,
  chevron,
  checked,
  danger,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
  checked?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors hover:bg-hover",
        danger ? "text-danger hover:bg-danger/10" : "text-foreground"
      )}
    >
      <span
        className={cn(
          "grid w-4 shrink-0 place-items-center",
          danger ? "text-danger" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      {chevron && <ChevronRight size={13} className="text-muted-foreground" />}
      {checked && <Check size={14} className="text-primary-600 dark:text-primary-400" />}
    </button>
  );
}

/** Hairline divider between groups of rows. */
export const MenuSep = () => <div className="mx-2 my-1 border-t border-border" />;

/* ── SelectMenu — native <select> replacement on the menu primitive ─────
 * Menu-button showing the current option's label + chevron; opens the
 * popover with a checked row per option. State wiring stays identical to
 * a select (value + onChange(value)); only presentation changes. Lists
 * over ~10 options scroll (max-h-72); disabled selects become disabled,
 * non-clickable buttons. size "md" = h-9 form rows, "sm" = h-8 toolbars. */

export type SelectOption = { value: string; label: string };

export function SelectMenu({
  value,
  onChange,
  options,
  size = "md",
  disabled,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** "sm" → h-8 toolbar rows, "md" → h-9 form inputs (matches .input). */
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The portal panel can't inherit width — pin it to the trigger's width.
  const [minW, setMinW] = useState<number | undefined>(undefined);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setMinW(btnRef.current?.offsetWidth);
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex w-full min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] text-foreground transition-colors",
          size === "sm" ? "h-8 px-2 text-xs" : "h-9",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-hover",
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? ""}
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>
      {!disabled && (
        <MenuPopover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={btnRef}
          closeOnScroll
          style={{ minWidth: minW }}
          className={cn(
            options.length > 10 && "max-h-72 overflow-y-auto"
          )}
        >
          {options.map((o) => (
            <MenuItemRow
              key={o.value}
              label={o.label}
              checked={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            />
          ))}
        </MenuPopover>
      )}
    </>
  );
}
