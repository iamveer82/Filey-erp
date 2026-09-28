import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
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
 * Radix owns positioning and focus/layer coordination with parent dialogs.
 * A bare body portal inherits a modal's pointer-events:none and becomes
 * unclickable even though its menu is visible. */

/** Anchored menu panel. Give it the open flag, a close callback and a ref to
 *  the trigger element; it handles positioning, dismissal and portal mounting. */
export function MenuPopover({
  open,
  onClose,
  anchorRef,
  side = "bottom",
  align = "start",
  closeOnScroll = false,
  role = "menu",
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
  role?: "menu" | "presentation";
  className?: string;
  /** Extra inline styles merged over the computed position (e.g. minWidth). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep handlers stable so listeners subscribe once per open/close.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !closeOnScroll) return;
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, closeOnScroll]);

  return <PopoverPrimitive.Root open={open} onOpenChange={next => { if (!next) closeRef.current(); }}>
    <PopoverPrimitive.Anchor virtualRef={anchorRef as RefObject<HTMLElement>} />
    <PopoverPrimitive.Portal><PopoverPrimitive.Content
      ref={panelRef}
      role={role}
      side={side} align={align} sideOffset={6} collisionPadding={8}
      style={{ ...style, pointerEvents: "auto" }}
      onOpenAutoFocus={event => { if (role === "presentation") event.preventDefault(); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (role === "menu" && document.activeElement === document.body) anchorRef.current?.focus({ preventScroll: true });
      }}
      onInteractOutside={event => { if (anchorRef.current?.contains(event.target as Node)) event.preventDefault(); }}
      onEscapeKeyDown={event => {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
        anchorRef.current?.focus({ preventScroll: true });
      }}
      onKeyDown={event => {
        if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        if ((event.target as HTMLElement).matches('input, textarea, [contenteditable="true"]') && ["Home", "End"].includes(event.key)) return;
        const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }}
      className={cn(
        // Every menu scrolls within the viewport and keeps its wheel events to
        // itself: the cap turns a 160-currency list into a scrollable panel,
        // overscroll-contain stops the scroll chaining to the page behind
        // (which used to close closeOnScroll menus at the end of the list).
        "z-50 max-h-[min(60vh,26rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1 shadow-lg outline-none",
        className
      )}
    >
      {children}
    </PopoverPrimitive.Content></PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
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
        "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-inset [@media(pointer:coarse)]:min-h-11",
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
 * Long lists scroll within the available viewport; disabled selects become
 * non-clickable buttons. size "md" = h-10 form rows, "sm" = h-8 toolbars. */

export type SelectOption = { value: string; label: string; group?: string };

export function SelectMenu({
  value,
  onChange,
  options,
  size = "md",
  disabled,
  ariaLabel,
  className,
  id,
  placeholder = "Choose an option",
  searchPlaceholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** "sm" → h-8 toolbar rows, "md" → h-10 form inputs (matches .input). */
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  id?: string;
  placeholder?: string;
  /** Enables a filter for longer lists while keeping the selected value. */
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  // The portal panel can't inherit width — pin it to the trigger's width.
  const [minW, setMinW] = useState<number | undefined>(undefined);
  const current = options.find((o) => o.value === value);
  const filtered = options.filter(o => `${o.label} ${o.group ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = () => {
    if (disabled) return;
    setMinW(btnRef.current?.offsetWidth);
    setQuery("");
    setOpen(v => !v);
  };
  return (
    <>
      <button
        type="button"
        id={id}
        ref={btnRef}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        onKeyDown={event => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          "inline-flex w-full min-w-0 items-center justify-between gap-1.5 rounded-[8px] border border-border bg-card px-3 text-[13px] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "h-8 px-2 text-xs" : "h-10 [@media(pointer:coarse)]:min-h-11",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-hover",
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? placeholder}
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
        >
          {searchPlaceholder && <div className="sticky -top-1 z-10 border-b border-border bg-card p-1 pb-2">
            <div className="relative">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="input pl-9" aria-label={searchPlaceholder} placeholder={searchPlaceholder}
                value={query} onChange={event => setQuery(event.target.value)} />
            </div>
          </div>}
          {filtered.map((o, index) => (
            <Fragment key={o.value}>
              {o.group && o.group !== filtered[index - 1]?.group && <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{o.group}</p>}
              <MenuItemRow
                label={o.label}
                checked={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              />
            </Fragment>
          ))}
          {!filtered.length && <p role="status" className="px-3 py-5 text-center text-sm text-muted-foreground">No matching options</p>}
        </MenuPopover>
      )}
    </>
  );
}
