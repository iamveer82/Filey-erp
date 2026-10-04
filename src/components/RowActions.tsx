import {
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "./Dialog";
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
import { isNativeApp, openNativeMessage } from "../lib/nativePlatform";

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
  const returnFocus = useRef<HTMLElement | null>(null);

  if (!open || !data) return null;
  // Portaled for the same reason as the row menu above: this dialog is rendered
  // from inside the table, and WebView2 composites a `fixed` overlay into the
  // scrolling table's layer and then only repaints part of it.
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }}
        className="flex max-w-2xl flex-col gap-0 overflow-hidden p-0 print:hidden"
      >
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0 basis-[12rem]">
            <div className="flex items-center gap-2 flex-wrap">
              <DialogTitle className="text-[15px] break-words [overflow-wrap:anywhere]">
                {data.title}
              </DialogTitle>
              {data.badge}
            </div>
            {data.subtitle && (
              <div className="text-[12.5px] text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
                {data.subtitle}
              </div>
            )}
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            {onPrint && (
              <button
                type="button"
                onClick={onPrint}
                className="btn-ghost text-[12.5px]"
              >
                <Printer className="h-4 w-4" /> Print
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="btn-ghost text-[12.5px]"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="btn-ghost h-10 w-10 p-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 p-5 overflow-y-auto overscroll-contain">
          {data.meta && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {data.meta.map((m, i) => (
                <div key={i} className="min-w-0">
                  <div className="text-[11.5px] text-muted-foreground">
                    {m.label}
                  </div>
                  <div className="text-[13px] font-medium text-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
                    {m.value ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.items && data.items.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table role="table" className="block w-full text-[13px] sm:table">
                <thead className="hidden sm:table-header-group">
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
                <tbody className="block sm:table-row-group">
                  {data.items.map((it, i) => (
                    <tr key={i} role="row" className="grid grid-cols-3 border-b border-border last:border-0 sm:table-row">
                      <td role="cell" className="col-span-3 block px-4 py-2 text-foreground break-words [overflow-wrap:anywhere] sm:table-cell">{it.desc}</td>
                      <td role="cell" className="block min-w-0 px-3 py-2 text-right text-foreground break-words tabular-nums sm:table-cell sm:px-4">
                        <span className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Qty</span>
                        {it.qty}
                      </td>
                      <td role="cell" className="block min-w-0 px-3 py-2 text-right text-foreground break-words tabular-nums sm:table-cell sm:px-4">
                        <span className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Unit price</span>
                        {Number(it.price || 0).toFixed(2)}
                      </td>
                      <td role="cell" className="block min-w-0 px-3 py-2 text-right text-foreground break-words tabular-nums sm:table-cell sm:px-4">
                        <span className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Amount</span>
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
              <div className="text-[13px] text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {data.notes}
              </div>
            </div>
          )}

          {data.footer}
        </div>
      </DialogContent>
    </Dialog>
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
    if (isNativeApp()) await openNativeMessage(link);
    else window.open(link, "_blank");
  } else if (kind === "email") {
    const link = `mailto:${email || ""}?subject=${encodeURIComponent(
      url || "Document"
    )}&body=${body}`;
    if (isNativeApp()) await openNativeMessage(link);
    else window.location.href = link;
  } else if (kind === "sms") {
    if (isNativeApp()) {
      const { internationalPhone } = await import("../lib/documentMessage");
      const raw = phone?.trim() || "";
      const recipient = raw ? internationalPhone(/^[1-9]/.test(raw) ? `+${raw}` : raw) : "";
      await openNativeMessage(`sms:${recipient}?body=${body}`);
    } else window.location.href = `sms:${phone || ""}?body=${body}`;
  } else if (kind === "copyLink") {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable. Try again in a supported browser.");
    await navigator.clipboard.writeText(url || window.location.href);
  }
}
