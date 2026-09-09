import { useRef, useState, type ReactNode } from "react";
import { Upload, X, Stamp, PenTool } from "lucide-react";
import { tools } from "../lib/api";
import { uploadCompanyAsset } from "../lib/files";
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

export const EMPTY_STAMP_SIG: CompanyStampSig = {
  stamp: undefined,
  signature: undefined,
};

const STAMP_KEY = "company_stamp";
const SIGN_KEY = "company_signature";

export const hasCompanyStampSig = (s?: CompanyStampSig | null): boolean =>
  !!s && (!!s.stamp?.data || !!s.signature?.data);

/** A signed Storage URL embeds the object path: `/object/sign/{bucket}/{path}?token=…`.
 *  Recovering it heals installs that persisted an expired URL over the path. */
function pathFromSignedUrl(u: string): string | null {
  const m = u.match(/\/object\/sign\/[^/]+\/(.+?)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Keep `data` a durable reference. It used to be swapped for a signed URL here,
 *  which the settings page then saved back — and those URLs expire in 5 minutes,
 *  so the stamp went permanently blank. Rendering resolves paths on its own
 *  (CompanyAssetImage), so nothing needs resolving at load time. */
function durable(parsed: Partial<StampSig>): Partial<StampSig> {
  const { _previewUrl: _drop, ...rest } = parsed;
  if (rest.data?.startsWith("http")) {
    const path = pathFromSignedUrl(rest.data);
    if (path) rest.data = path;
  }
  return rest;
}

/** Heal a stamp/signature stored ON A DOCUMENT.
 *
 *  Invoices keep their own snapshot of the stamp, and documents saved before
 *  the settings page stopped persisting signed URLs hold a link that expired
 *  five minutes later — so those invoices print blank while newer ones are
 *  fine. Recovering the storage path lets the renderer sign it afresh. Data
 *  URLs and plain paths pass through untouched. */
export function durableStampSig<T extends { data?: string } | undefined>(v: T): T {
  if (!v?.data?.startsWith("http")) return v;
  const path = pathFromSignedUrl(v.data);
  return path ? ({ ...v, data: path } as T) : v;
}

export async function loadCompanyStampSig(): Promise<CompanyStampSig> {
  try {
    const rows = await tools.settings();
    const stampRow = rows.find((r) => r.key === STAMP_KEY);
    const signRow = rows.find((r) => r.key === SIGN_KEY);
    const out: CompanyStampSig = {};
    if (stampRow?.value) {
      const parsed = durable(JSON.parse(stampRow.value) as Partial<StampSig>);
      if (parsed.data) out.stamp = { ...STAMP_DEFAULT, ...parsed };
    }
    if (signRow?.value) {
      const parsed = durable(JSON.parse(signRow.value) as Partial<StampSig>);
      if (parsed.data) out.signature = { ...SIGN_DEFAULT, ...parsed };
    }
    return out;
  } catch (e) {
    console.warn("Failed to load company stamp/signature", e);
    return { ...EMPTY_STAMP_SIG };
  }
}

export async function saveCompanyStampSig(s: CompanyStampSig): Promise<void> {
  // _previewUrl is a short-lived signed URL — persisting it shadowed `data`
  // with a link that had already expired by the next visit.
  const persist = (v?: StampSig) => {
    if (!v) return {};
    const { _previewUrl: _drop, ...rest } = v;
    return rest;
  };
  await tools.setSetting(STAMP_KEY, JSON.stringify(persist(s.stamp)));
  await tools.setSetting(SIGN_KEY, JSON.stringify(persist(s.signature)));
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
  const [err, setErr] = useState("");

  const handleFile = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    setErr("");
    try {
      const { path, url } = await uploadCompanyAsset(f);
      // Persist the storage path in settings; keep the signed URL in memory for preview
      onChange({ ...defaults, data: path, _previewUrl: url });
    } catch (e) {
      // A console warning left the card sitting on "Upload" — indistinguishable
      // from never having picked a file, so the stamp was quietly never saved.
      setErr(
        e instanceof Error ? e.message : `Could not upload that ${label.toLowerCase()}.`
      );
    } finally {
      setUploading(false);
    }
  };

  // Prefer the durable reference (data: URL in local mode, storage path in cloud)
  // over the transient signed URL — _previewUrl expires in 5 minutes and would
  // show a broken image once it does. CompanyAssetImage resolves storage paths
  // on its own, so `data` is always the safe choice.
  const previewUrl = value?.data || value?._previewUrl;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
        {icon} {label}
      </div>
      <div className="mt-3">
        {previewUrl ? (
          <div className="flex flex-wrap items-center gap-3">
            <CompanyAssetImage
              src={previewUrl}
              alt={label}
              className="object-contain rounded"
              style={{
                width: `${(180 * (value?.scale ?? 100)) / 100}px`,
                maxWidth: "100%",
                maxHeight: `${(80 * (value?.scale ?? 100)) / 100}px`,
                clipPath: `inset(${value?.cropTop}% ${value?.cropRight}% ${value?.cropBottom}% ${value?.cropLeft}%)`,
                opacity: (value?.opacity ?? 100) / 100,
              }}
            />
            <button
              title={`Remove ${label.toLowerCase()}`}
              aria-label={`Remove ${label.toLowerCase()}`}
              className="btn-ghost w-10 shrink-0 p-0 text-danger"
              onClick={() => onChange(undefined)}
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              aria-label={`Upload ${label}`}
              disabled={uploading}
              onClick={() => ref.current?.click()}
              className="btn-ghost"
            >
              <Upload size={16} />
              <span>{uploading ? "Uploading…" : "Upload"}</span>
            </button>
            <p className="text-xs text-muted-foreground">Transparent PNG works best</p>
          </div>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {err && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {err}
          </p>
        )}
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
