/* Barcodes for products: check, generate and draw EAN-13 (UPC-A is EAN-13 with a leading 0).
 *
 * EAN-13 is what shop scanners read on almost every retail pack. A product without a printed
 * code gets an in-store EAN-13: prefix 2 is reserved by GS1 for numbers used inside one shop,
 * so it never clashes with a manufacturer's code. Other codes (letters, other lengths) are kept
 * and scanned as typed, but are not drawn: printing them needs an encoder we have verified. */

/** EAN-13 digit patterns: L (odd parity), G (even parity) and R (right half). */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
/** Which of L/G each left-half digit uses, set by the first (implied) digit. */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export const EAN13_TABLES = { L, G, R, PARITY };

/** The check digit for the first 12 digits of an EAN-13 (or the 11 of a UPC-A, padded). */
export function ean13CheckDigit(first12: string): number {
  const digits = first12.padStart(12, "0").split("").map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export type BarcodeKind = "" | "ean13" | "upca" | "bad-check" | "other";

/** What a typed or scanned code is. */
export function barcodeKind(code: string): BarcodeKind {
  const c = code.trim();
  if (!c) return "";
  if (!/^\d{12,13}$/.test(c)) return "other";
  const full = c.length === 12 ? `0${c}` : c;
  if (ean13CheckDigit(full.slice(0, 12)) !== Number(full[12])) return "bad-check";
  return c.length === 12 ? "upca" : "ean13";
}

/** The check digit a 12/13-digit code should end with (for "check digit should be X"). */
export function expectedCheckDigit(code: string): number | null {
  const c = code.trim();
  if (!/^\d{12,13}$/.test(c)) return null;
  const full = c.length === 12 ? `0${c}` : c;
  return ean13CheckDigit(full.slice(0, 12));
}

/** The 95 modules (1 = bar) of a valid EAN-13 or UPC-A, or null for anything else. */
export function ean13Modules(code: string): string | null {
  const kind = barcodeKind(code);
  if (kind !== "ean13" && kind !== "upca") return null;
  const d = (code.trim().length === 12 ? `0${code.trim()}` : code.trim()).split("").map(Number);
  const parity = PARITY[d[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

/** A new in-store EAN-13 (prefix 2) not in `taken`. */
export function generateEan13(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set([...taken].map((c) => c.trim()));
  for (let attempt = 0; attempt < 1000; attempt++) {
    let body = "2";
    for (let i = 0; i < 11; i++) body += Math.floor(random() * 10);
    const code = body + ean13CheckDigit(body);
    if (!used.has(code)) return code;
  }
  throw new Error("Could not find a free barcode. Try again.");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

/** The barcode as an SVG (bars, longer guard bars, digits underneath), or "" when it cannot be drawn. */
export function barcodeSvg(code: string, { height = 60, digits = true } = {}): string {
  const bits = ean13Modules(code);
  if (!bits) return "";
  const full = code.trim().length === 12 ? `0${code.trim()}` : code.trim();
  const quiet = 11; // left quiet zone, room for the leading digit
  const width = quiet + 95 + 7;
  const textH = digits ? 10 : 0;
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  let bars = "";
  for (let i = 0; i < 95; i++) {
    if (bits[i] !== "1") continue;
    let run = 1;
    while (i + run < 95 && bits[i + run] === "1" && guard(i + run) === guard(i)) run++;
    bars += `<rect x="${quiet + i}" y="0" width="${run}" height="${guard(i) ? height + textH * 0.5 : height}"/>`;
    i += run - 1;
  }
  const text = digits
    ? `<g font-family="monospace" font-size="9" text-anchor="middle">` +
      `<text x="${quiet - 5}" y="${height + 9}">${full[0]}</text>` +
      `<text x="${quiet + 3 + 21}" y="${height + 9}" textLength="38">${full.slice(1, 7)}</text>` +
      `<text x="${quiet + 50 + 21}" y="${height + 9}" textLength="38">${full.slice(7)}</text></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + textH}" role="img" aria-label="Barcode ${esc(full)}" shape-rendering="crispEdges"><rect width="${width}" height="${height + textH}" fill="#fff"/><g fill="#000">${bars}</g>${text}</svg>`;
}

export type LabelSize = "38x25" | "50x25" | "a4";
export interface LabelItem { name: string; code: string; price?: string; sku?: string }

/** A printable page of barcode labels: one label per sticker on a label roll, or 3 × 8 on A4. */
export function labelSheetHtml(items: LabelItem[], size: LabelSize, copies: number): string {
  const n = Math.max(1, Math.min(500, Math.floor(copies)));
  const labels = items.filter((i) => ean13Modules(i.code)).flatMap((i) => Array.from({ length: n }, () => i));
  const page = size === "a4" ? "size: A4; margin: 10mm 7mm" : `size: ${size.replace("x", "mm ")}mm; margin: 0`;
  const cell = size === "a4"
    ? "width:66mm;height:33.9mm;padding:2mm 3mm"
    : `width:${size.split("x")[0]}mm;height:${size.split("x")[1]}mm;padding:1mm 1.5mm;page-break-after:always`;
  const body = labels.map((l) => `<div class="l" style="${cell}">` +
    `<div class="n">${esc(l.name)}</div>${barcodeSvg(l.code, { height: 40 })}` +
    `<div class="m"><span>${esc(l.sku ?? "")}</span><b>${esc(l.price ?? "")}</b></div></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
@page { ${page} }
* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; color: #000; }
.wrap { display: ${size === "a4" ? "grid; grid-template-columns: repeat(3, 66mm); gap: 0 2mm" : "block"}; }
.l { overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
.l svg { width: 100%; height: 0; flex: 1 1 auto; min-height: 0; }
.n { font-size: 8pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m { display: flex; justify-content: space-between; font-size: 7pt; }
</style></head><body><div class="wrap">${body}</div></body></html>`;
}
