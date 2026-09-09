import { useRef, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import { tools } from "../lib/api";

/* Company letterhead — a single full-page A4 image that prints BEHIND the
 * document body. This is how most UAE businesses brand LPOs, declaration
 * letters and other correspondence: a pre-designed A4 sheet (logo band on
 * top, contact band at the bottom) sits in the background and the body text
 * flows on top of it, clear of the printed header/footer artwork.
 *
 * Stored as a single JSON app-setting (`company_letterhead`) so it syncs
 * across devices with no DB migration — same pattern as BankDetails. The
 * image is a base64 data URL sized to A4 (210 × 297 mm). Per-document spacing
 * (how far the body clears the top header art and bottom footer art) is set
 * on each document, not here, so the same letterhead suits every layout. */

export interface LetterheadInfo {
  /** Full-page A4 letterhead image (base64 data URL), printed behind the body. */
  background: string;
}

export const EMPTY_LETTERHEAD: LetterheadInfo = { background: "" };

/** Default px (at 794-wide A4) the body clears the letterhead header/footer. */
export const DEFAULT_HEADER_SPACE = 150;
export const DEFAULT_FOOTER_SPACE = 140;
/** Default left/right body padding when a letterhead is applied. */
export const DEFAULT_SIDE_SPACE = 56;

const SETTING_KEY = "company_letterhead";

export const hasLetterhead = (l?: LetterheadInfo | null): boolean =>
  !!l && !!l.background;

/** Load saved letterhead (empty record if none / not configured).
 * Tolerates the legacy header/footer-band shape by ignoring it — those
 * installs simply re-upload a full-page letterhead. */
export async function loadLetterhead(): Promise<LetterheadInfo> {
  try {
    const rows = await tools.settings();
    const row = rows.find((r) => r.key === SETTING_KEY);
    if (!row?.value) return { ...EMPTY_LETTERHEAD };
    const parsed = JSON.parse(row.value) as Partial<LetterheadInfo>;
    return { ...EMPTY_LETTERHEAD, ...parsed };
  } catch (e) {
    console.warn("Failed to load letterhead:", e);
    return { ...EMPTY_LETTERHEAD };
  }
}

export async function saveLetterhead(l: LetterheadInfo): Promise<void> {
  await tools.setSetting(SETTING_KEY, JSON.stringify(l));
}

/* ------------------------------------------------------------------ */
/* Config panel (Settings → Company Details, Template Designer) */
/* ------------------------------------------------------------------ */

/** Full-page A4 letterhead upload. Drop into Settings or the template
 * designer — keeps the same `{ value, onChange }` API as before. */
export function LetterheadConfig({
  value,
  onChange,
}: {
  value: LetterheadInfo;
  onChange: (l: LetterheadInfo) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onChange({ ...value, background: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <div className="min-w-0 space-y-3">
      {value.background ? (
        <div className="flex flex-wrap items-start gap-4">
          <img
            src={value.background}
            alt="Letterhead"
            className="h-auto w-28 rounded-[8px] border border-border"
            style={{ aspectRatio: "210 / 297", objectFit: "cover" }}
          />
          <button
            type="button"
            title="Remove letterhead"
            aria-label="Remove letterhead"
            className="btn-ghost text-danger"
            onClick={() => onChange({ ...value, background: "" })}
          >
            <X size={15} /> Remove letterhead
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="btn-ghost"
          >
            <Upload size={16} />
            <span>Upload full A4 letterhead</span>
          </button>
          <p className="text-xs text-muted-foreground">
            Header and footer artwork on one A4 page · PNG or JPG
          </p>
        </div>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Render frame (wraps a document body on the A4 sheet) */
/* ------------------------------------------------------------------ */

/** Wrap a document body so the letterhead prints full-bleed BEHIND it and the
 * body flows on top, clear of the header/footer artwork.
 *
 * The parent should be a full-bleed A4 sheet with NO padding — this frame
 * owns the body padding. `headerSpace` / `footerSpace` push the body down
 * from the top and up from the bottom so it never sits over the letterhead's
 * printed bands; raise them to make more room. When `enabled` is false (or no
 * letterhead is configured) the background is omitted and a plain uniform
 * `bodyPadding` is used, so the same frame works for every document. */
export function LetterheadFrame({
  letterhead,
  enabled = true,
  minHeight = 1123,
  headerSpace = DEFAULT_HEADER_SPACE,
  footerSpace = DEFAULT_FOOTER_SPACE,
  sidePadding = DEFAULT_SIDE_SPACE,
  bodyPadding = 48,
  className = "",
  bodyClassName = "",
  children,
}: {
  letterhead?: LetterheadInfo | null;
  enabled?: boolean;
  minHeight?: number;
  /** Top clearance (px) for the letterhead header band. */
  headerSpace?: number;
  /** Bottom clearance (px) for the letterhead footer band. */
  footerSpace?: number;
  /** Left/right body padding (px) when a letterhead is applied. */
  sidePadding?: number;
  /** Uniform body padding (px) used when no letterhead is applied. */
  bodyPadding?: number;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const on = enabled && hasLetterhead(letterhead);
  const bodyStyle = on
    ? {
        paddingTop: headerSpace,
        paddingBottom: footerSpace,
        paddingLeft: sidePadding,
        paddingRight: sidePadding,
      }
    : { padding: bodyPadding };
  return (
    <div className={`relative ${className}`} style={{ minHeight }}>
      {on && (
        <img
          src={letterhead!.background}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
          style={{ objectFit: "fill" }}
        />
      )}
      <div className={`relative ${bodyClassName}`} style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}
