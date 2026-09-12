// Adapted from Comp AI's detail-sheet.tsx. MIT; see licenses/comp-ai-crm.txt.
import { useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../Sheet";

export default function RecordSheet({
  title,
  description,
  media,
  onClose,
  onBack,
  backLabel,
  busy,
  children,
}: {
  title: string;
  description: string;
  media: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  busy: boolean;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        ref={content}
        showCloseButton={false}
        className="crm-record-sheet flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          {onBack && (
            <button
              type="button"
              className="btn-ghost mb-3 self-start max-w-full"
              disabled={busy}
              onClick={onBack}
            >
              <ArrowLeft size={14} className="shrink-0" />
              <span className="truncate">Back to {backLabel || "record"}</span>
            </button>
          )}
          <div className="flex items-start gap-3">
            {media}
            <div className="min-w-0 flex-1">
              <SheetTitle className="break-words text-xl font-semibold text-foreground">
                {title}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs text-muted-foreground">
                {description}
              </SheetDescription>
            </div>
            <button
              type="button"
              className="btn-ghost h-10 w-10 shrink-0 p-0"
              aria-label="Close dialog"
              disabled={busy}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
