import { encode } from "uqr";
import { money } from "../lib/format";
import { upiError, upiLink } from "../lib/upi";

/** Scan-to-pay UPI QR for an Indian invoice. Drawn as plain SVG squares, so it
 *  prints and exports to PDF as sharp as the text around it. */
export default function UpiQr({ vpa, name, amount, note, className = "" }: {
  vpa?: string | null;
  name?: string | null;
  amount: number;
  note?: string | null;
  className?: string;
}) {
  const id = (vpa ?? "").trim();
  if (!id || upiError(id) || !(amount > 0)) return null;
  const qr = encode(upiLink({ vpa: id, name, amount, note }), { ecc: "M", border: 2 });
  const cells: string[] = [];
  qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) cells.push(`M${x} ${y}h1v1h-1z`); }));
  return <div data-upi-qr className={`mt-3 flex break-inside-avoid items-center gap-3 text-left text-neutral-900 ${className}`}>
    <svg role="img" aria-label={`UPI QR code to pay ${money(amount, "INR")} to ${id}`} viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={96} height={96} shapeRendering="crispEdges" className="shrink-0 bg-white">
      <path d={cells.join("")} fill="#000" />
    </svg>
    <div className="min-w-0 text-[11px] leading-4">
      <p className="font-semibold">Scan to pay {money(amount, "INR")}</p>
      <p className="text-neutral-500">With any UPI app</p>
      <p dir="ltr" className="break-all font-medium text-neutral-800">{id}</p>
    </div>
  </div>;
}
