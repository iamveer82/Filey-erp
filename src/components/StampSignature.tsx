import { useRef, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import { CompanyAssetImage } from "./CompanyAssetImage";
import { uploadCompanyAsset } from "../lib/files";

/* Shared stamp & signature widgets used by every document builder
 * (Invoicing, Quoting, Purchase Orders, Declaration Letter, …).
 * - StampSig: the stored shape ({data, position %, opacity, crop}).
 * - StampSigCard: the upload / opacity / crop config panel.
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
  opacity: 30,
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
  opacity: 35,
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

/* ---------------- Config card (upload / opacity / crop) ---------------- */

export function StampSigCard({
  label,
  icon,
  value,
  onChange,
  defaults,
}: {
  label: string;
  icon: ReactNode;
  value?: StampSig;
  onChange: (v: StampSig | undefined) => void;
  defaults: StampSig;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="rounded-xl border border-brand-200 p-4">
      <div className="flex items-center gap-2 text-ink font-medium text-sm">
        {icon} {label}
      </div>
      <div className="mt-3">
        {value?.data ? (
          <div className="space-y-3">
            {/* preview with inline remove */}
            <div className="relative flex items-center justify-center py-4 rounded-xl bg-brand-50/40 dark:bg-white/[0.03] border border-brand-100/50 min-h-[100px]">
              <CompanyAssetImage
                src={value.data}
                alt={label}
                className="object-contain rounded"
                style={{
                  width: `${(180 * (value.scale ?? 100)) / 100}px`,
                  maxHeight: `${(80 * (value.scale ?? 100)) / 100}px`,
                  clipPath: `inset(${value.cropTop}% ${value.cropRight}% ${value.cropBottom}% ${value.cropLeft}%)`,
                  opacity: value.opacity / 100,
                }}
              />
              <button
                title={`Remove ${label.toLowerCase()}`}
                aria-label={`Remove ${label.toLowerCase()}`}
                className="absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-xl bg-white/90 border border-brand-200 text-danger hover:bg-red-50 transition-colors"
                onClick={() => onChange(undefined)}
              >
                <X size={13} />
              </button>
            </div>
            {/* opacity */}
            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-brand-500">Opacity</span>
                <span className="text-[11px] font-mono tabular-nums text-brand-600">
                  {value.opacity}%
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                value={value.opacity}
                className="w-full h-1.5 accent-brand-500 cursor-pointer"
                onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) })}
              />
            </label>
            {/* size / scale */}
            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-brand-500">Size</span>
                <span className="text-[11px] font-mono tabular-nums text-brand-600">
                  {value.scale}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={200}
                value={value.scale}
                className="w-full h-1.5 accent-brand-500 cursor-pointer"
                onChange={(e) => onChange({ ...value, scale: Number(e.target.value) })}
              />
            </label>
            {/* crop edges */}
            <div>
              <p className="text-[11px] font-medium text-brand-400 mb-1.5">Crop edges</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(["cropTop", "cropRight", "cropBottom", "cropLeft"] as const).map(
                  (k, i) => (
                    <div
                      key={k}
                      className="flex items-center gap-1 rounded-xl border border-brand-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200"
                    >
                      <span className="text-[10px] font-mono font-medium text-brand-400">
                        {["T", "R", "B", "L"][i]}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={value[k]}
                        className="w-full min-w-0 border-0 bg-transparent text-[11px] text-brand-700 focus:outline-none"
                        onChange={(e) =>
                          onChange({
                            ...value,
                            [k]: Math.min(90, Math.max(0, Number(e.target.value) || 0)),
                          })
                        }
                      />
                    </div>
                  )
                )}
              </div>
            </div>
            <p className="text-[11px] text-brand-400">
              Drag it directly on the preview to position it on the page.
            </p>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-brand-200 cursor-pointer hover:border-brand-400 hover:bg-brand-50/10 transition-all min-h-[100px] disabled:opacity-60">
            <Upload size={18} className="text-brand-400" />
            <span className="text-xs font-medium text-brand-600">
              {uploading ? "Uploading…" : `Upload ${label}`}
            </span>
            <span className="text-[10px] text-brand-400">Transparent PNG works best</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                // uploadCompanyAsset already forks on data mode: a data: URL
                // offline, a Storage path in the cloud. Either way what is
                // stored is durable — a raw FileReader result was not, in the
                // cloud, because nothing ever uploaded the bytes.
                setUploading(true);
                setErr("");
                try {
                  const { path } = await uploadCompanyAsset(f);
                  onChange({ ...defaults, data: path });
                } catch (e2) {
                  setErr(
                    e2 instanceof Error ? e2.message : `Could not upload that ${label.toLowerCase()}.`
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        )}
        {/* A failed upload used to be a console warning: the card went back to
            "Upload", which reads as "nothing happened", not "it didn't save". */}
        {err && <p className="mt-2 text-[11px] text-danger">{err}</p>}
      </div>
    </div>
  );
}

/* ---------------- Compact per-document adjuster (opacity + crop) ----------------
 * Rendered on a document editor when the stamp/signature toggle is ON. Edits a
 * per-document copy of the StampSig (image inherited from company settings) so
 * each document can tune opacity and crop without changing the saved company
 * asset. Position is set by dragging the watermark directly on the sheet. */
export function StampSigAdjust({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  value: StampSig;
  onChange: (v: StampSig) => void;
}) {
  const s = (value.scale ?? 100) / 100;
  return (
    <div className="rounded-xl border border-brand-200 p-3">
      <div className="flex items-center gap-2 text-ink font-medium text-xs">
        {icon} {label}
      </div>
      {/* live preview — mirrors the on-page watermark blend */}
      <div className="relative mt-2 flex items-center justify-center py-3 rounded-xl bg-brand-50/40 dark:bg-white/[0.03] border border-brand-100/50 min-h-[72px]">
        <CompanyAssetImage
          src={value.data}
          alt={label}
          className="object-contain"
          style={{
            width: `${140 * s}px`,
            maxHeight: `${64 * s}px`,
            clipPath: `inset(${value.cropTop}% ${value.cropRight}% ${value.cropBottom}% ${value.cropLeft}%)`,
            opacity: value.opacity / 100,
            mixBlendMode: "multiply",
          }}
        />
      </div>
      {/* opacity */}
      <label className="block mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-brand-500">Opacity</span>
          <span className="text-[11px] tabular-nums text-brand-600">{value.opacity}%</span>
        </div>
        <input
          type="range"
          min={5}
          max={100}
          value={value.opacity}
          className="w-full h-1.5 accent-brand-500 cursor-pointer"
          onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) })}
        />
      </label>
      {/* crop edges */}
      <div className="mt-3">
        <p className="text-[11px] font-medium text-brand-400 mb-1.5">Crop edges (%)</p>
        <div className="grid grid-cols-4 gap-1.5">
          {(["cropTop", "cropRight", "cropBottom", "cropLeft"] as const).map((k, i) => (
            <div
              key={k}
              className="flex items-center gap-1 rounded-xl border border-brand-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200"
            >
              <span className="text-[10px] tabular-nums font-medium text-brand-400">
                {["T", "R", "B", "L"][i]}
              </span>
              <input
                type="number"
                min={0}
                max={90}
                value={value[k]}
                className="w-full min-w-0 border-0 bg-transparent text-[11px] text-brand-700 focus:outline-none"
                onChange={(e) =>
                  onChange({
                    ...value,
                    [k]: Math.min(90, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
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
