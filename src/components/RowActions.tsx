import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Trash2,
  MessageCircle,
  Mail,
  Phone,
  Link2,
  X,
  Printer,
  Users,
} from "lucide-react";
import { MenuPopover, MenuItemRow, MenuSep } from "./ui-menu";
import { cn } from "../lib/format";

/**
 * RowActions — reusable action bar for table rows (Filey-DEMO parity).
 *  - onView / onEdit / onCopy / onDelete: plain callbacks
 *  - onSend: { whatsapp, email, sms, copyLink } — each a callback
 *  - align: "right" | "left"
 */
/** Row menus sit inside the DataTable wrapper, which clips (overflow-hidden +
 *  overflow-x-auto in ui.tsx), and WebView2 composites non-ported menus into
 *  the scrolling layer and partially repaints them — so the panels render
 *  through the shared MenuPopover portal, anchored to their trigger button.
 *  closeOnScroll keeps the table behaviour: a scrolling table closes its row
 *  menu rather than dragging it along. */

export function RowActions({
  onView,
  onEdit,
  onCopy,
  onDelete,
  onSend,
  onShare,
  shareLabel = "Share",
  align = "right",
}: {
  onView?: () => void;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  /** Team-share this record — appears in the row menu. */
  onShare?: () => void;
  shareLabel?: string;
  onSend?: {
    whatsapp?: () => void;
    email?: () => void;
    sms?: () => void;
    copyLink?: () => void;
  };
  align?: "right" | "left";
}) {
  const [open, setOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const btn = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";
  const actions = [
    { label: "Edit", icon: <Pencil size={16} />, run: onEdit },
    { label: "Duplicate", icon: <Copy size={16} />, run: onCopy },
    { label: shareLabel, icon: <Users size={16} />, run: onShare },
    { label: "WhatsApp", icon: <MessageCircle size={16} />, run: onSend?.whatsapp },
    { label: "Email", icon: <Mail size={16} />, run: onSend?.email },
    { label: "SMS", icon: <Phone size={16} />, run: onSend?.sms },
    { label: "Copy link", icon: <Link2 size={16} />, run: onSend?.copyLink },
    { label: "Delete", icon: <Trash2 size={16} />, run: onDelete, danger: true },
  ].filter(action => action.run);

  return <div onClick={event => event.stopPropagation()} className={cn("flex items-center gap-0.5", align === "right" && "justify-end")}>
    {onView && <button type="button" onClick={e => { e.stopPropagation(); onView(); }}
      title="Quick view" aria-label="Quick view" className={btn}><Eye size={16} /></button>}
    {actions.length > 0 && <>
      <button type="button" ref={moreBtn} onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} className={btn}>
        <MoreHorizontal size={16} />
      </button>
      <MenuPopover open={open} onClose={() => setOpen(false)} anchorRef={moreBtn} align="end" closeOnScroll className="w-44">
        {actions.map(action => <div key={action.label}>
          {action.danger && actions.length > 1 && <MenuSep />}
          <MenuItemRow label={action.label} icon={action.icon} danger={action.danger}
            onClick={() => { setOpen(false); action.run!(); }} />
        </div>)}
      </MenuPopover>
    </>}
  </div>;
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
                className="btn-ghost text-[12.5px]"
              >
                <Printer className="h-4 w-4" /> Print
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="btn-ghost text-[12.5px]"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="btn-ghost h-10 w-10 p-0"
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

/** Open a share destination or await a confirmed clipboard write. Callers must
 *  await/catch before reporting success; clipboard permission may be denied. */
export async function shareVia(
  kind: ShareKind,
  {
    phone,
    email,
    text,
    url,
  }: { phone?: string; email?: string; text?: string; url?: string }
): Promise<void> {
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
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable. Try again in a supported browser.");
    await navigator.clipboard.writeText(url || window.location.href);
  }
}
