import { useRef, useId, type ReactNode } from "react";
import { CompanyAssetImage } from "./CompanyAssetImage";

/* Shared stamp & signature widgets used by every document builder
 * (Invoicing, Quoting, Purchase Orders, Declaration Letter, …).
 * - StampSig: the stored shape ({data, position %, opacity, crop}).
 * - StampSigAdjust: the shared appearance controls.
 * - StampSignatureLayer: the draggable overlay rendered on the A4 sheet.
 *
 * Positioning is expressed as 0–100 % of the sheet (center anchored), so it
 * is resolution-independent and survives the FitPreview zoom transform —
 * dragging reads the parent's bounding rect, which is already scaled. */

export type StampSig = {
  /** Durable reference: a Storage path (cloud) or a data: URL (local mode).
   *  Never a signed URL — those expire in minutes. */
  data: string;
  /** Transient fresh signed URL, kept in memory so a just-uploaded image shows
   *  immediately. Stripped before persisting. */
  _previewUrl?: string;
  x: number;
  y: number;
  opacity: number;
  color: string;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  scale: number;
};

export const STAMP_DEFAULT: StampSig = {
  data: "",
  x: 75,
  y: 70,
  opacity: 100,
  color: "#cc0000",
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  scale: 100,
};

export const SIGN_DEFAULT: StampSig = {
  data: "",
  x: 75,
  y: 85,
  opacity: 100,
  color: "#0000cc",
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  scale: 100,
};

/** Hydrate a (possibly partial) DB record into a full StampSig, or undefined. */
export function normStampSig(
  v: Partial<StampSig> | null | undefined,
  def: StampSig
): StampSig | undefined {
  if (!v || !v.data) return undefined;
  return {
    data: v.data,
    x: v.x ?? def.x,
    y: v.y ?? def.y,
    opacity: v.opacity ?? def.opacity,
    color: v.color ?? def.color,
    cropTop: v.cropTop ?? 0,
    cropRight: v.cropRight ?? 0,
    cropBottom: v.cropBottom ?? 0,
    cropLeft: v.cropLeft ?? 0,
    scale: v.scale ?? def.scale,
  };
}

/** Shared per-document controls. Changes never replace the company asset. */
export function StampSigAdjust({ label, icon, value, onChange }: {
  label: string;
  icon?: ReactNode;
  value: StampSig;
  onChange: (v: StampSig) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 text-foreground">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-medium">{icon}{label}</h3>
        <button type="button" className="btn-ghost text-xs" aria-label={`Reset ${label.toLowerCase()} adjustments`}
          onClick={() => onChange({ ...value, opacity: 100, scale: 100, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 })}>Reset</button>
      </div>
      <div className="flex h-32 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-3">
        <CompanyAssetImage src={value.data} alt={`${label} preview`} className="max-w-full object-contain"
          style={{ width: 140 * (value.scale ?? 100) / 100, maxHeight: 96,
            clipPath: `inset(${value.cropTop}% ${value.cropRight}% ${value.cropBottom}% ${value.cropLeft}%)`, opacity: (value.opacity ?? 100) / 100 }} />
      </div>
      {([['opacity', 'Opacity', 5, 100], ['scale', 'Size', 20, 200]] as const).map(([key, title, min, max]) => (
        <label key={key} className="block text-xs" htmlFor={`${id}-${key}`}>
          <span className="flex justify-between gap-3"><span>{title}</span><output className="tabular-nums text-muted-foreground">{value[key] ?? 100}%</output></span>
          <input id={`${id}-${key}`} aria-label={`${label} ${title.toLowerCase()}`} type="range" min={min} max={max} value={value[key] ?? 100}
            className="h-10 w-full cursor-pointer accent-brand-500" onChange={e => onChange({ ...value, [key]: Number(e.target.value) })} />
        </label>
      ))}
      <details className="border-t border-border pt-2">
        <summary className="cursor-pointer py-2 text-xs text-muted-foreground">Crop edges</summary>
        <div className="grid grid-cols-2 gap-3 pt-2">
          {(['cropTop', 'cropRight', 'cropBottom', 'cropLeft'] as const).map((key, i) => (
            <label key={key} className="space-y-1 text-xs text-muted-foreground">
              <span>{['Top', 'Right', 'Bottom', 'Left'][i]} (%)</span>
              <input aria-label={`${label} crop ${['top', 'right', 'bottom', 'left'][i]}`} type="number" min={0} max={90} value={value[key]}
                className="input w-full" onChange={e => onChange({ ...value, [key]: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })} />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}

/* ---------------- Draggable overlay (rendered on the A4 sheet) ---------------- */

function DraggableMark({
  mark,
  maxH,
  maxW,
  alt,
  onMove,
}: {
  mark: StampSig;
  maxH: number;
  maxW: number;
  alt: string;
  onMove: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const s = (mark.scale ?? 100) / 100;
  const h = maxH * s;
  const w = maxW * s;

  const move = (clientX: number, clientY: number) => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    onMove(Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current) move(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (e) {
          /* capture may already be released */
          console.warn("releasePointerCapture failed:", e);
        }
      }}
      title={`Drag to position ${alt.toLowerCase()}`}
      style={{
        position: "absolute",
        left: `${mark.x}%`,
        top: `${mark.y}%`,
        transform: "translate(-50%, -50%)",
        maxHeight: h,
        maxWidth: w,
        cursor: "grab",
        touchAction: "none",
        zIndex: 5,
      }}
    >
      <CompanyAssetImage
        src={mark.data}
        alt={alt}
        className="block"
        style={{
          maxHeight: h,
          maxWidth: w,
          opacity: mark.opacity / 100,
          mixBlendMode: "multiply",
          clipPath: `inset(${mark.cropTop}% ${mark.cropRight}% ${mark.cropBottom}% ${mark.cropLeft}%)`,
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
    </div>
  );
}

/* ── Draggable block for text content (bank details, notes, etc.) ── */
export function DraggableBlock({
  x,
  y,
  children,
  onMove,
}: {
  x: number;
  y: number;
  children: ReactNode;
  onMove: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientX: number, clientY: number) => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((clientX - rect.left) / rect.width) * 100;
    const ny = ((clientY - rect.top) / rect.height) * 100;
    onMove(Math.max(0, Math.min(100, nx)), Math.max(0, Math.min(100, ny)));
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current) move(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (e) {
          /* capture may already be released */
          console.warn("releasePointerCapture failed:", e);
        }
      }}
      title="Drag to position"
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        cursor: "grab",
        touchAction: "none",
        zIndex: 5,
        maxWidth: "90%",
      }}
    >
      {children}
    </div>
  );
}

/** Drop this inside a `position:relative` wrapper around the document body.
 * Renders the stamp/signature where they belong and lets the user drag
 * them anywhere on the A4 sheet. */
export function StampSignatureLayer({
  stamp,
  signature,
  onStampMove,
  onSignatureMove,
}: {
  stamp?: StampSig;
  signature?: StampSig;
  onStampMove: (x: number, y: number) => void;
  onSignatureMove: (x: number, y: number) => void;
}) {
  stamp = normStampSig(stamp, STAMP_DEFAULT);
  signature = normStampSig(signature, SIGN_DEFAULT);
  return (
    <>
      {stamp?.data && (
        <DraggableMark
          mark={stamp}
          maxH={100}
          maxW={200}
          alt="Stamp"
          onMove={onStampMove}
        />
      )}
      {signature?.data && (
        <DraggableMark
          mark={signature}
          maxH={60}
          maxW={250}
          alt="Signature"
          onMove={onSignatureMove}
        />
      )}
    </>
  );
}
