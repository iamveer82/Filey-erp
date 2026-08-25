import { fmtDate, money } from "../lib/format";
import { taxRegimeFor } from "../lib/taxRegimes";

/* A classic business receipt voucher: company header, centred spaced title,
 * underlined field rows, a solid amount block, "received from" party block
 * and an authorised-signature line. Deliberately NOT an invoice layout —
 * no item grid, no totals ladder, no tax rows. Rendered at true A4 width
 * (794px); the PDF export captures this node directly. */

/** Darken a hex colour for heading text on white (accent at ~72%). */
function darken(hex: string | undefined, k = 0.72): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1f2937";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export interface ReceiptVoucherProps {
  sellerName?: string | null;
  sellerAddress?: string | null;
  sellerTrn?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  /** ISO date the payment was made. */
  date?: string | null;
  /** Reference row — falls back to the receipt number when empty. */
  reference?: string | null;
  paymentMode?: string | null;
  amount?: number | null;
  currency?: string;
  accent?: string;
  amountWords?: string | null;
  forDescription?: string | null;
  logo?: string | null;
}

export default function ReceiptVoucher({
  sellerName,
  sellerAddress,
  sellerTrn,
  customerName,
  customerAddress,
  date,
  reference,
  paymentMode,
  amount,
  currency = "AED",
  accent = "#222222",
  amountWords,
  forDescription,
  logo,
}: ReceiptVoucherProps) {
  const ink = darken(accent);
  const rows: [string, string][] = [
    ["Payment Date", date ? fmtDate(date) : "—"],
    ["Reference Number", reference || "—"],
    ["Payment Mode", paymentMode || "—"],
  ];

  return (
    <div
      className="relative bg-white text-neutral-900 flex flex-col"
      style={{ width: 794, minHeight: 1123, padding: "56px 60px 0" }}
    >
      {/* Company header */}
      <div>
        {logo && <img src={logo} alt="" className="h-12 mb-3 object-contain" />}
        <p className="text-[17px] font-bold tracking-tight" style={{ color: ink }}>
          {sellerName || "Company"}
        </p>
        {sellerAddress && (
          <p
            className="text-[11px] leading-relaxed whitespace-pre-line mt-0.5"
            style={{ color: accent }}
          >
            {sellerAddress}
          </p>
        )}
        {sellerTrn && (
          <p className="text-[11px] mt-0.5" style={{ color: accent }}>
            {taxRegimeFor(currency).trnLabel}: {sellerTrn}
          </p>
        )}
      </div>

      <div className="border-b border-neutral-200 mt-5" />

      {/* Title */}
      <p className="text-center text-[13px] font-semibold tracking-[0.35em] text-neutral-700 mt-8">
        RECEIPT VOUCHER
      </p>

      {/* Fields + amount block */}
      <div className="flex items-start gap-8 mt-8">
        <div className="flex-1 space-y-5 pt-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-end gap-3">
              <span className="w-36 shrink-0 text-[11px] text-neutral-500">{label}</span>
              <span className="flex-1 border-b border-neutral-300 pb-1 text-[12.5px] font-medium">
                {value}
              </span>
            </div>
          ))}
        </div>
        <div
          className="shrink-0 px-6 py-4 text-white"
          style={{ backgroundColor: accent, minWidth: 190 }}
        >
          <p className="text-[10px] opacity-90">Amount:</p>
          <p className="text-[17px] font-bold tabular-nums mt-0.5">
            {money(amount || 0, currency)}
          </p>
        </div>
      </div>

      {(amountWords || forDescription) && (
        <div className="mt-5 text-[11px] text-neutral-500 leading-relaxed">
          {forDescription && <p>Being payment towards: {forDescription}</p>}
          {amountWords && <p className="italic">Amount in words: {amountWords}</p>}
        </div>
      )}

      {/* Received from */}
      <div className="mt-14">
        <p className="text-[10px] tracking-wide text-neutral-400">Received From</p>
        <p className="text-[13.5px] font-bold mt-1.5">{customerName || "—"}</p>
        {customerAddress && (
          <p className="text-[12px] text-neutral-600 whitespace-pre-line leading-relaxed mt-1">
            {customerAddress}
          </p>
        )}
      </div>

      {/* Authorised signature line — the stamp/signature overlay drops the
          image just above this label when enabled. */}
      <div className="absolute right-[72px] bottom-[150px] text-center">
        <div className="h-10" />
        <p className="text-[10px] text-neutral-400">Authorized Signature</p>
      </div>

      {/* Footer bands */}
      <div className="absolute bottom-0 left-0 right-0">
        <div className="mx-10 h-9 bg-neutral-100" />
        <div className="mx-10 border-b border-neutral-200 mt-3 pb-4" />
      </div>
    </div>
  );
}
