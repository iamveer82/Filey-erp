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
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Send,
  Trash2,
  MessageCircle,
  Mail,
  Phone,
  Link2,
  X,
  Printer,
} from "lucide-react";
import { cn } from "../lib/format";

/**
 * RowActions — reusable action bar for table rows (Filey-DEMO parity).
 *  - onView / onEdit / onCopy / onDelete: plain callbacks
 *  - onSend: { whatsapp, email, sms, copyLink } — each a callback
 *  - align: "right" | "left"
 */
/** Row menus sit inside the DataTable wrapper, which clips (overflow-hidden +
 *  overflow-x-auto in ui.tsx) — an absolutely-positioned dropdown was cut off
 *  and put a scrollbar on the table instead of showing Delete. Fixed position
 *  isn't clipped by an ancestor's overflow, so the menu is measured off its
 *  trigger button instead. Anchored to `bottom` when the trigger sits near the
 *  viewport floor, so the menu grows upward without having to measure it.
 *
 *  The menu is also rendered through a portal (see MenuSurface). Position
 *  fixed alone was not enough on the desktop build: WebView2 composited the
 *  menu into the scrolling table's layer and then only repainted the first
 *  row of it, so Send appeared to offer WhatsApp and nothing else — the Email
 *  and SMS entries were laid out at full size but never painted. */
function useMenuPosition(open: boolean, anchor: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const right = Math.max(8, window.innerWidth - r.right);
      setPos(
        spaceBelow < 160
          ? { bottom: window.innerHeight - r.top + 4, right }
          : { top: r.bottom + 4, right }
      );
    };
    place();
    // A fixed menu doesn't follow a scrolling table — close rather than drift.
    const onScroll = () => setPos(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);

  return pos;
}

export function RowActions({
  onView,
  onEdit,
  onCopy,
  onDelete,
  onSend,
  align = "right",
}: {
  onView?: () => void;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onSend?: {
    whatsapp?: () => void;
    email?: () => void;
    sms?: () => void;
    copyLink?: () => void;
  };
  align?: "right" | "left";
}) {
  const [openSend, setOpenSend] = useState(false);
  const [openMore, setOpenMore] = useState(false);
  const sendRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const sendBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  // The menus render in a portal, so they are no longer inside sendRef/moreRef
  // in the DOM. Without their own refs the mousedown below would count a click
  // on a menu item as "outside", unmount the menu, and the click would never
  // reach the item — the action would silently do nothing.
  const sendMenu = useRef<HTMLDivElement>(null);
  const moreMenu = useRef<HTMLDivElement>(null);
  const sendPos = useMenuPosition(openSend, sendBtn);
  const morePos = useMenuPosition(openMore, moreBtn);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (
        sendRef.current &&
        !sendRef.current.contains(t) &&
        !sendMenu.current?.contains(t)
      )
        setOpenSend(false);
      if (
        moreRef.current &&
        !moreRef.current.contains(t) &&
        !moreMenu.current?.contains(t)
      )
        setOpenMore(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const btn =
    "h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover border border-transparent hover:border-border transition-colors";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        align === "right" && "justify-end"
      )}
    >
      {onView && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          title="Quick view"
          aria-label="Quick view"
          className={btn}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      )}
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit"
          aria-label="Edit"
          className={btn}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onCopy && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          title="Duplicate"
          aria-label="Duplicate"
          className={btn}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
      {onSend && (
        <div className="relative" ref={sendRef}>
          <button
            ref={sendBtn}
            onClick={(e) => {
              e.stopPropagation();
              setOpenSend((v) => !v);
            }}
            title="Send"
            aria-label="Send"
            className={btn}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
          {openSend && sendPos && (
            <MenuSurface style={sendPos} width="w-44" ref={sendMenu}>
              {onSend.whatsapp && (
                <MenuItem
                  icon={MessageCircle}
                  label="WhatsApp"
                  onClick={() => {
                    setOpenSend(false);
                    onSend.whatsapp!();
                  }}
                  iconClass="text-emerald-500"
                />
              )}
              {onSend.email && (
                <MenuItem
                  icon={Mail}
                  label="Email"
                  onClick={() => {
                    setOpenSend(false);
                    onSend.email!();
                  }}
                  iconClass="text-sky-500"
                />
              )}
              {onSend.sms && (
                <MenuItem
                  icon={Phone}
                  label="SMS"
                  onClick={() => {
                    setOpenSend(false);
                    onSend.sms!();
                  }}
                  iconClass="text-amber-500"
                />
              )}
              {onSend.copyLink && (
                <>
                  <div className="my-1 border-t border-border" />
                  <MenuItem
                    icon={Link2}
                    label="Copy link"
                    onClick={() => {
                      setOpenSend(false);
                      onSend.copyLink!();
                    }}
                  />
                </>
              )}
            </MenuSurface>
          )}
        </div>
      )}
      {onDelete && (
        <div className="relative" ref={moreRef}>
          <button
            ref={moreBtn}
            onClick={(e) => {
              e.stopPropagation();
              setOpenMore((v) => !v);
            }}
            title="More"
            aria-label="More actions"
            className={btn}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {openMore && morePos && (
            <MenuSurface style={morePos} width="w-40" ref={moreMenu}>
              <MenuItem
                icon={Trash2}
                label="Delete"
                onClick={() => {
                  setOpenMore(false);
                  onDelete();
                }}
                iconClass="text-red-500"
                labelClass="text-red-500"
              />
            </MenuSurface>
          )}
        </div>
      )}
    </div>
  );
}

/** The floating menu panel, rendered into <body> so no ancestor's overflow or
 *  compositing layer owns it. The theme class lives on <html>, so the portal
 *  keeps dark mode. */
function MenuSurface({
  style,
  width,
  ref,
  children,
}: {
  style: CSSProperties;
  width: string;
  ref: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return createPortal(
    <div
      ref={ref}
      style={style}
      className={cn(
        "fixed z-50 rounded-md border border-border bg-card shadow-lg py-1 text-[13px]",
        width
      )}
    >
      {children}
    </div>,
    document.body
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  iconClass = "text-muted-foreground",
  labelClass = "text-foreground",
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  iconClass?: string;
  labelClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-hover transition-colors"
    >
      <Icon className={cn("h-3.5 w-3.5", iconClass)} />
      <span className={labelClass}>{label}</span>
    </button>
  );
}

export type QuickViewData = {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  meta?: { label: string; value: ReactNode }[];
  /** `amount` is the line's real total — it is not qty × price whenever the
   *  line carries a manual amount, a formula or a per-line discount. Callers
   *  reading a stored document should pass storedLineAmount(); the fallback
   *  only holds for plain lines. */
  items?: { desc: string; qty: number; price: number; amount?: number }[];
  total?: number;
  currency?: string;
  notes?: string;
  footer?: ReactNode;
};

/**
 * QuickViewModal — lightweight modal to preview a record (Filey-DEMO parity).
 * Renders title + badge, a meta grid, an optional line-items table, total,
 * and notes. Closes on backdrop click and Escape.
 */
export function QuickViewModal({
  open,
  onClose,
  data,
  onEdit,
  onPrint,
}: {
  open: boolean;
  onClose: () => void;
  data: QuickViewData | null;
  onEdit?: () => void;
  onPrint?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !data) return null;
  // Portaled for the same reason as the row menu above: this dialog is rendered
  // from inside the table, and WebView2 composites a `fixed` overlay into the
  // scrolling table's layer and then only repaints part of it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4 print:hidden"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="materialize-surface w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[15px] font-semibold text-foreground">
                {data.title}
              </div>
              {data.badge}
            </div>
            {data.subtitle && (
              <div className="text-[12.5px] text-muted-foreground mt-0.5">
                {data.subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onPrint && (
              <button
                onClick={onPrint}
                className="h-8 px-3 rounded-md text-[12.5px] border border-border hover:bg-hover text-foreground inline-flex items-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="h-8 px-3 rounded-md text-[12.5px] border border-border hover:bg-hover text-foreground inline-flex items-center gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {data.meta && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {data.meta.map((m, i) => (
                <div key={i}>
                  <div className="text-[11.5px] text-muted-foreground">
                    {m.label}
                  </div>
                  <div className="text-[13px] font-medium text-foreground mt-0.5">
                    {m.value || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.items && data.items.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border bg-hover/30">
                    <th className="px-4 py-2 font-medium text-[11.5px]">
                      Description
                    </th>
                    <th className="px-4 py-2 font-medium text-[11.5px] w-16 text-right">
                      Qty
                    </th>
                    <th className="px-4 py-2 font-medium text-[11.5px] w-24 text-right">
                      Unit price
                    </th>
                    <th className="px-4 py-2 font-medium text-[11.5px] w-28 text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-foreground">{it.desc}</td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {it.qty}
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {Number(it.price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {Number(
                          it.amount ?? Number(it.qty || 0) * Number(it.price || 0)
                        ).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {typeof data.total !== "undefined" && (
            <div className="mt-4 flex items-center justify-end gap-6">
              <div className="text-[12.5px] text-muted-foreground">Total</div>
              <div className="text-[18px] font-semibold text-foreground">
                {data.currency || "AED"}{" "}
                {Number(data.total || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
          )}

          {data.notes && (
            <div className="mt-4 rounded-lg border border-border p-3 bg-hover/20">
              <div className="text-[11.5px] font-medium text-muted-foreground mb-1">
                Notes
              </div>
              <div className="text-[13px] text-foreground whitespace-pre-wrap">
                {data.notes}
              </div>
            </div>
          )}

          {data.footer}
        </div>
      </div>
    </div>,
    document.body
  );
}

export type ShareKind = "whatsapp" | "email" | "sms" | "copyLink";

/** Helper to build share URLs. Opens in a new tab (Filey-DEMO parity). */
export function shareVia(
  kind: ShareKind,
  {
    phone,
    email,
    text,
    url,
  }: { phone?: string; email?: string; text?: string; url?: string }
) {
  const body = encodeURIComponent(text || "");
  if (kind === "whatsapp") {
    const num = (phone || "").replace(/[^\d]/g, "");
    const link = num
      ? `https://wa.me/${num}?text=${body}`
      : `https://wa.me/?text=${body}`;
    window.open(link, "_blank");
  } else if (kind === "email") {
    const link = `mailto:${email || ""}?subject=${encodeURIComponent(
      url || "Document"
    )}&body=${body}`;
    window.location.href = link;
  } else if (kind === "sms") {
    const link = `sms:${phone || ""}?body=${body}`;
    window.location.href = link;
  } else if (kind === "copyLink") {
    navigator.clipboard.writeText(url || window.location.href);
  }
}
