import { useRef, useState, type ReactNode } from "react";
import { Upload, X, Stamp, PenTool } from "lucide-react";
import { tools } from "../lib/api";
import { uploadCompanyAsset, companyAssetUrl } from "../lib/files";
import { STAMP_DEFAULT, SIGN_DEFAULT, type StampSig } from "./StampSignature";
import { CompanyAssetImage } from "./CompanyAssetImage";

/* Company-wide stamp & signature images uploaded once in
 * Settings → Company Details, then optionally enabled per document.
 *
 * Images are uploaded to Supabase Storage (`files` bucket) and only the
 * storage path + a cached signed URL are kept in `app_settings`. This keeps
 * settings small, makes images follow the user across devices, and survives
 * browser cache clearing. */

export interface CompanyStampSig {
  stamp?: StampSig;
  signature?: StampSig;
}

export const EMPTY_STAMP_SIG: CompanyStampSig = { stamp: undefined, signature: undefined };

const STAMP_KEY = "company_stamp";
const SIGN_KEY = "company_signature";

export const hasCompanyStampSig = (s?: CompanyStampSig | null): boolean =>
  !!s && (!!s.stamp?.data || !!s.signature?.data);

export async function loadCompanyStampSig(): Promise<CompanyStampSig> {
  try {
    const rows = await tools.settings();
    const stampRow = rows.find((r) => r.key === STAMP_KEY);
    const signRow = rows.find((r) => r.key === SIGN_KEY);
    const out: CompanyStampSig = {};
    // A data: URL (local mode) is the image itself; only a Storage path needs a
    // fresh signed URL.
    const isStoragePath = (d: string) =>
      !d.startsWith("data:") && (d.startsWith("files/") || d.includes("/company/"));
    if (stampRow?.value) {
      const parsed = JSON.parse(stampRow.value) as Partial<StampSig>;
      if (parsed.data) {
        if (isStoragePath(parsed.data)) {
          const url = await companyAssetUrl(parsed.data);
          if (url) parsed.data = url;
        }
        out.stamp = { ...STAMP_DEFAULT, ...parsed };
      }
    }
    if (signRow?.value) {
      const parsed = JSON.parse(signRow.value) as Partial<StampSig>;
      if (parsed.data) {
        if (isStoragePath(parsed.data)) {
          const url = await companyAssetUrl(parsed.data);
          if (url) parsed.data = url;
        }
        out.signature = { ...SIGN_DEFAULT, ...parsed };
      }
    }
    return out;
  } catch (e) {
    console.warn("Failed to load company stamp/signature", e);
    return { ...EMPTY_STAMP_SIG };
  }
}

export async function saveCompanyStampSig(s: CompanyStampSig): Promise<void> {
  await tools.setSetting(STAMP_KEY, JSON.stringify(s.stamp ?? {}));
  await tools.setSetting(SIGN_KEY, JSON.stringify(s.signature ?? {}));
}

/* ------------------------------------------------------------------ */
/* Settings panel cards (Settings → Company Details)                  */
/* ------------------------------------------------------------------ */

function UploadCard({
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
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try {
      const { path, url } = await uploadCompanyAsset(f);
      // Persist the storage path in settings; keep the signed URL in memory for preview
      onChange({ ...defaults, data: path, _previewUrl: url } as StampSig);
    } catch (e) {
      console.warn(`Failed to upload ${label.toLowerCase()}`, e);
    } finally {
      setUploading(false);
    }
  };

  const previewUrl = (value as any)?._previewUrl || value?.data;

  return (
    <div className="rounded-3xl border border-brand-200 p-4 dark:border-[#2C2C2E]">
      <div className="flex items-center gap-2 text-ink font-medium text-sm">
        {icon} {label}
      </div>
      <div className="mt-3">
        {previewUrl ? (
          <div className="relative flex items-center justify-center py-4 rounded-3xl bg-brand-50/40 dark:bg-white/[0.03] border border-brand-100/50 min-h-[100px]">
            <CompanyAssetImage
              src={previewUrl}
              alt={label}
              className="object-contain rounded"
              style={{
                width: `${(180 * (value?.scale ?? 100)) / 100}px`,
                maxHeight: `${(80 * (value?.scale ?? 100)) / 100}px`,
                clipPath: `inset(${value?.cropTop}% ${value?.cropRight}% ${value?.cropBottom}% ${value?.cropLeft}%)`,
                opacity: (value?.opacity ?? 100) / 100,
              }}
            />
            <button
              title={`Remove ${label.toLowerCase()}`}
              aria-label={`Remove ${label.toLowerCase()}`}
              className="absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded-3xl bg-white/90 border border-brand-200 text-danger hover:bg-red-50 transition-colors"
              onClick={() => onChange(undefined)}
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => ref.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1.5 py-8 rounded-3xl border-2 border-dashed border-brand-200 cursor-pointer hover:border-brand-400 hover:bg-brand-50/10 transition-all disabled:opacity-60"
          >
            <Upload size={18} className="text-brand-400" />
            <span className="text-xs font-medium text-brand-600">
              {uploading ? "Uploading…" : `Upload ${label}`}
            </span>
            <span className="text-[10px] text-brand-400">Transparent PNG works best</span>
          </button>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

export function StampSignatureSettings({
  value,
  onChange,
}: {
  value: CompanyStampSig;
  onChange: (s: CompanyStampSig) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UploadCard
        label="Company Stamp"
        icon={<Stamp size={15} />}
        value={value.stamp}
        onChange={(v) => onChange({ ...value, stamp: v })}
        defaults={STAMP_DEFAULT}
      />
      <UploadCard
        label="Company Signature"
        icon={<PenTool size={15} />}
        value={value.signature}
        onChange={(v) => onChange({ ...value, signature: v })}
        defaults={SIGN_DEFAULT}
      />
    </div>
  );
}
