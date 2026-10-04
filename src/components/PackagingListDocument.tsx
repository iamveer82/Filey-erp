import { useEffect, useReducer, type CSSProperties, type RefObject } from "react";
import { fmtDate } from "../lib/format";
import { packagingTotals, type PackagingForm, type PackagingItem } from "../lib/packagingLists";
import { CompanyAssetImage } from "./CompanyAssetImage";
import { A4_H, A4_W } from "./InvoiceExportSheet";
import { StampSignatureLayer } from "./StampSignature";
import type { CompanyStampSig } from "./StampSignatureSettings";
import "./PackagingListDocument.css";

export const PACKAGING_TEMPLATES = [
  { id: "packing-minimal", name: "Minimal Manifest", description: "Open rows, quiet letterhead, and a clear shipment summary." },
  { id: "packing-trade", name: "Classic Trade", description: "Centered company details with a black header and a full table grid." },
  { id: "packing-dispatch", name: "Dispatch Docket", description: "Framed dispatch details, ruled items, and a boxed shipment summary." },
  { id: "packing-warehouse", name: "Warehouse Ledger", description: "Compact letterhead, striped item rows, and a receiving signoff." },
] as const;

interface PrintItem extends PackagingItem {
  sourceIndex: number;
  continuation: boolean;
}

export interface PackagingPage {
  items: PrintItem[];
  notes: string;
  quantities: [string, number][];
}

const number = new Intl.NumberFormat("en", { maximumSignificantDigits: 12 });
const scientific = new Intl.NumberFormat("en", { notation: "scientific", maximumSignificantDigits: 12 });
const displayNumber = (value: number | null) => {
  if (value == null) return "—";
  const formatted = number.format(value);
  return formatted.length > 14 ? scientific.format(value) : formatted;
};
const templateId = (form: PackagingForm) => PACKAGING_TEMPLATES.some(t => t.id === form.template) ? form.template : "packing-trade";
const descriptionWidth = (form: PackagingForm) => 82 - (form.show_packages ? 16 : 0) - (form.show_net_weight ? 16 : 0) - (form.show_gross_weight ? 16 : 0);

/** Keep every character, including explicit line breaks, when a row continues. */
function textLines(text: string, width: number): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [""];
  return lines.flatMap(line => {
    const chunks: string[] = [];
    const characters = Array.from(line);
    for (let i = 0; i < characters.length; i += width) chunks.push(characters.slice(i, i + width).join(""));
    return chunks.length ? chunks : [""];
  });
}

const textContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");

/** Use the selected face; keep a conservative fallback for server rendering. */
function measuredLines(text: string, width: number, font: string, size = 10.5, weight = 400): number {
  if (textContext) textContext.font = `${weight} ${size}px ${font || "Inter, Arial, sans-serif"}`;
  const measure = (value: string) => textContext ? textContext.measureText(value).width * 1.08 : Array.from(value).reduce((sum, character) => sum + (character.codePointAt(0)! > 255 ? 12 : /[MWmw@%&]/.test(character) ? 11 : /[ilI1.,:;!'| ]/.test(character) ? 4 : 7.5), 0) * size / 10.5;
  return text.split(/\r?\n/).reduce((count, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.match(/\S+\s*|\s+/gu) || [""]) {
      if (used && used + measure(word) > width) { lines++; used = 0; }
      for (const character of word) {
        const characterWidth = measure(character);
        if (used && used + characterWidth > width) { lines++; used = 0; }
        used += characterWidth;
      }
    }
    return count + lines;
  }, 0);
}

const columnLines = (text: string, percent: number, font: string) => measuredLines(text, 698 * percent / 100 - 10, font);

function conservativeHeaderHeight(form: PackagingForm, compact = false, continuation = false): number {
  const trade = templateId(form) === "packing-trade";
  const brandWidth = (compact || trade ? 698 : 312) - (form.show_logo && form.company_logo ? compact ? 76 : 114 : 0);
  const brandChars = Math.max(12, Math.floor(brandWidth / (compact ? 10 : 11)));
  const brandHeight = Math.max(62, textLines(form.company_name, Math.max(6, Math.floor(brandWidth / (compact ? 14 : trade ? 23 : 19)))).length * (compact ? 19 : 30)
    + (continuation ? [] : [form.company_address, form.company_trn, [form.company_phone, form.company_email].filter(Boolean).join(" · ")])
      .filter(Boolean).reduce((height, value) => height + textLines(value, brandChars).length * (compact ? 14 : 17), 0));
  const partyChars = compact && !continuation ? 65 : 29;
  const recipientLines = textLines(form.recipient_name, compact && !continuation ? 55 : 24).length
    + (continuation ? [] : [form.recipient_address, form.recipient_email, form.recipient_phone])
      .filter(Boolean).reduce((count, value) => count + textLines(value, partyChars).length, 0) + 2;
  const shippingLines = textLines(form.shipping_address || form.recipient_address, partyChars).length + 2;
  const partyHeight = compact && !continuation ? (recipientLines + shippingLines) * 14 + 24 : Math.max(recipientLines, shippingLines) * (compact ? 14 : 17);
  const metadata = [form.number || "—", form.issue_date, ...(continuation ? [] : [form.invoice_reference, form.order_reference, form.dispatch_date, form.carrier, form.tracking_number])].filter(Boolean);
  let metadataHeight = 0;
  for (let i = 0; i < metadata.length; i += 4) metadataHeight += Math.max(...metadata.slice(i, i + 4).map(value => textLines(value, compact ? 17 : 13).length)) * (compact ? 13 : 17) + (compact ? 24 : 28);
  return (compact ? 58 : trade ? 108 : 72) + brandHeight + metadataHeight + partyHeight;
}

const compactHeader = (form: PackagingForm) => conservativeHeaderHeight(form) > 500;

function headerHeight(form: PackagingForm, compact: boolean, continuation = false): number {
  if (compact) return conservativeHeaderHeight(form, true, continuation);
  const layout = templateId(form);
  const trade = layout === "packing-trade";
  const dispatch = layout === "packing-dispatch";
  const warehouse = layout === "packing-warehouse";
  const contentWidth = dispatch ? 662 : 698;
  const brandWidth = trade ? 698 : dispatch ? (662 - 25) / 2.15 : warehouse ? (698 - 24) * 1.15 / 2.15 : (698 - 28) / 2.15;
  const hasLogo = form.show_logo && !!form.company_logo;
  const nameSize = trade ? 23 : dispatch ? 16 : 17;
  const brandTextWidth = brandWidth - (hasLogo ? 114 : 0);
  const brand = Math.max(hasLogo ? 62 : 0,
    measuredLines(form.company_name || "Your company", brandTextWidth, form.font, nameSize, 750) * nameSize * 1.3 + 7
    + [form.company_address, form.company_trn ? `TRN: ${form.company_trn}` : "", [form.company_phone, form.company_email].filter(Boolean).join(" · ")]
      .filter(Boolean).reduce((height, value) => height + measuredLines(value, brandTextWidth, form.font, 11) * 16.5, 0));
  const metadata = [form.number || "—", fmtDate(form.issue_date), form.invoice_reference, form.order_reference, form.dispatch_date ? fmtDate(form.dispatch_date) : "", form.carrier, form.tracking_number].filter(Boolean);
  let metadataHeight = 0;
  for (let i = 0; i < metadata.length; i += 4) {
    metadataHeight += 16.5 + Math.max(...metadata.slice(i, i + 4).map(value => measuredLines(value, (contentWidth - 60) / 4, form.font, warehouse ? 10 : 11, 600))) * (warehouse ? 15 : 16.5) + (i ? 12 : 0);
  }
  const header = trade ? brand + 43.75 + metadataHeight + 62
    : dispatch ? Math.max(brand, 54.35) + metadataHeight + 65
    : warehouse ? Math.max(brand, 46.75) + metadataHeight + 46
    : Math.max(brand, 58.95) + metadataHeight + 52;
  const partyWidth = trade ? 318 : dispatch ? 308 : 335;
  const recipient = 20.5 + measuredLines(form.recipient_name || "—", partyWidth, form.font, 13, 650) * 19.5
    + (form.recipient_address ? 3 + measuredLines(form.recipient_address, partyWidth, form.font, 11) * 16.5 : 0)
    + [form.recipient_phone, form.recipient_email].filter(Boolean).reduce((height, value) => height + measuredLines(value, partyWidth, form.font, 11) * 16.5, 0);
  const shipping = 23.5 + measuredLines(form.shipping_address || form.recipient_address || "—", partyWidth, form.font, 11) * 16.5;
  return header + Math.max(recipient, shipping) + (trade || dispatch ? 26 : 0) + (warehouse ? 36 : 44);
}

/** Recalculate after a selected web font replaces its temporary fallback. */
export function usePackagingPages(form: PackagingForm): PackagingPage[] {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let active = true;
    const ready = () => { if (active) refresh(); };
    void fonts.ready.then(ready);
    fonts.addEventListener("loadingdone", ready);
    return () => { active = false; fonts.removeEventListener("loadingdone", ready); };
  }, [form.font]);
  return paginatePackagingItems(form);
}

/**
 * ponytail: mirror fixed header spacing and use conservative description budgets; measure actual DOM
 * rows if typography or paper margins become user-configurable.
 */
export function paginatePackagingItems(form: PackagingForm): PackagingPage[] {
  const chars = Math.max(16, Math.floor(698 * descriptionWidth(form) / 100 / 11));
  const compact = compactHeader(form);
  let available = Math.max(compact ? 0 : 150, 1027 - headerHeight(form, compact) - 88);
  const continuedAvailable = compact ? Math.max(150, 1027 - headerHeight(form, true, true) - 88) : available;
  const totals = packagingTotals(form.items);
  const quantities = Object.entries(totals.quantities);
  const totalFields = Number(form.show_packages) + Number(form.show_net_weight) + Number(form.show_gross_weight);
  const summaryRowHeight = quantities.some(([unit, qty]) => columnLines("Quantity · " + unit, 30, form.font) > 1 || displayNumber(qty).length > 18)
    || form.show_packages && displayNumber(totals.packages).length > 18
    || form.show_net_weight && displayNumber(totals.net).length > 17
    || form.show_gross_weight && displayNumber(totals.gross).length > 17 ? 64 : 44;
  const incompleteWeights = form.items.some(item => form.show_net_weight && item.net_weight == null || form.show_gross_weight && item.gross_weight == null);
  const finalHeight = (quantityCount: number) => 180 + (templateId(form) === "packing-minimal" ? 0 : 16) + Math.ceil((quantityCount + totalFields) / 3) * summaryRowHeight
    + Math.max(0, textLines(form.prepared_by, 18).length * 18 - 40) + (incompleteWeights ? 24 : 0);
  const pages: PackagingPage[] = [{ items: [], notes: "", quantities: [] }];
  let used = 0;
  const newPage = () => { pages.push({ items: [], notes: "", quantities: [] }); used = 0; available = continuedAvailable; };
  const rowLineLimit = Math.max(1, Math.floor((continuedAvailable - 30) / 16));

  form.items.forEach((item, sourceIndex) => {
    const lines = textLines(item.description, chars);
    for (let start = 0; start < lines.length; start += rowLineLimit) {
      const part = lines.slice(start, start + rowLineLimit);
      const numericLines = [item.qty, ...(form.show_packages ? [item.package_count] : []),
        ...(form.show_net_weight ? [item.net_weight, item.net_weight == null ? null : item.qty * item.net_weight] : []),
        ...(form.show_gross_weight ? [item.gross_weight, item.gross_weight == null ? null : item.qty * item.gross_weight] : [])]
        .map(value => columnLines(displayNumber(value), 7, form.font));
      const otherLines = start ? 1 : Math.max(...numericLines, columnLines(item.unit, 7, form.font), form.show_packages ? columnLines(item.package_type, 9, form.font) : 1);
      const height = Math.max(part.length, otherLines) * 16 + (start ? 30 : 20);
      if ((used || pages.length === 1) && used + height > available) newPage();
      pages[pages.length - 1].items.push({ ...item, description: part.join(""), sourceIndex, continuation: start > 0 });
      used += height;
    }
  });

  const noteLines = form.notes ? textLines(form.notes, 60) : [];
  let noteIndex = 0;
  while (noteIndex < noteLines.length) {
    const fits = Math.floor((available - used - 54) / 18);
    if (fits < 1) { newPage(); continue; }
    const count = Math.min(fits, noteLines.length - noteIndex);
    pages[pages.length - 1].notes = noteLines.slice(noteIndex, noteIndex + count).join("");
    used += count * 18 + 54;
    noteIndex += count;
    if (noteIndex < noteLines.length) newPage();
  }
  const quantityLimit = Math.max(3, Math.floor((continuedAvailable - finalHeight(0) - 32) / summaryRowHeight) * 3);
  let finalPlaced = false;
  for (let i = 0; i < quantities.length; i += quantityLimit) {
    const group = quantities.slice(i, i + quantityLimit);
    const isLast = i + quantityLimit >= quantities.length;
    const height = isLast ? finalHeight(group.length) : Math.ceil(group.length / 3) * summaryRowHeight + 40;
    if ((used || pages.length === 1) && used + height > available) newPage();
    pages[pages.length - 1].quantities = group;
    used += height;
    if (isLast) finalPlaced = true;
    else newPage();
  }
  if (!finalPlaced && used + finalHeight(0) > available) newPage();
  return pages;
}

export default function PackagingListDocument({
  form, companyStampSig, onChange, pageIndex, documentRef,
}: {
  form: PackagingForm;
  companyStampSig?: CompanyStampSig;
  onChange?: (form: PackagingForm) => void;
  pageIndex?: number;
  /** Optional standalone export host. Omit when a caller already owns the host. */
  documentRef?: RefObject<HTMLDivElement | null>;
}) {
  const pages = usePackagingPages(form);
  const totals = packagingTotals(form.items);
  const layout = templateId(form).replace("packing-", "");
  const compact = compactHeader(form);
  const selected = pageIndex == null ? pages.map((page, index) => ({ page, index })) : [{ page: pages[Math.min(Math.max(0, pageIndex), pages.length - 1)], index: Math.min(Math.max(0, pageIndex), pages.length - 1) }];
  const metadata = [
    ["List number", form.number || "—"], ["Issue date", fmtDate(form.issue_date)],
    ...(form.invoice_reference ? [["Invoice reference", form.invoice_reference]] : []),
    ...(form.order_reference ? [["Order reference", form.order_reference]] : []),
    ...(form.dispatch_date ? [["Dispatch date", fmtDate(form.dispatch_date)]] : []),
    ...(form.carrier ? [["Carrier", form.carrier]] : []),
    ...(form.tracking_number ? [["Tracking number", form.tracking_number]] : []),
  ];
  const stamp = form.show_stamp ? form.stamp || companyStampSig?.stamp : undefined;
  const signature = form.show_signature ? form.signature || companyStampSig?.signature : undefined;
  const hasNet = form.items.some(item => item.net_weight != null);
  const hasGross = form.items.some(item => item.gross_weight != null);
  const summary = [
    ...(form.show_packages ? [["Total packages", form.items.some(item => item.package_count != null) ? displayNumber(totals.packages) : "—"]] : []),
    ...(form.show_net_weight ? [["Total net weight", hasNet ? `${displayNumber(totals.net)} ${form.weight_unit}` : "—"]] : []),
    ...(form.show_gross_weight ? [["Total gross weight", hasGross ? `${displayNumber(totals.gross)} ${form.weight_unit}` : "—"]] : []),
  ];
  const sheets = <>{selected.map(({ page, index }) => {
    const isLast = index === pages.length - 1;
    const continuation = compact && index > 0;
    return <div key={index} data-packaging-page={index + 1} data-pdf-single="true" className={`invoice-print packing-sheet packing-${layout}${compact ? " packing-compact" : ""}${continuation ? " packing-continuation" : ""}`} data-packaging-template={templateId(form)} data-no-i18n dir="ltr"
      style={{ width: A4_W, height: A4_H, "--packing-accent": form.accent || "#222222", fontFamily: form.font || "Inter, Arial, sans-serif" } as CSSProperties}>
      <div className="packing-body">
        {isLast && <StampSignatureLayer stamp={stamp} signature={signature}
          onStampMove={(x, y) => { if (stamp) onChange?.({ ...form, stamp: { ...stamp, x, y } }); }}
          onSignatureMove={(x, y) => { if (signature) onChange?.({ ...form, signature: { ...signature, x, y } }); }} />}
        <header className="packing-header">
          <div className="packing-brand">
            {form.show_logo && form.company_logo && <CompanyAssetImage src={form.company_logo} alt={`${form.company_name || "Company"} logo`} />}
            <div><p className="packing-company" dir="auto">{form.company_name || "Your company"}</p>
              {!continuation && form.company_address && <p className="packing-address" dir="auto">{form.company_address}</p>}
              {!continuation && form.company_trn && <p>TRN: {form.company_trn}</p>}
              {!continuation && (form.company_phone || form.company_email) && <p>{[form.company_phone, form.company_email].filter(Boolean).join(" · ")}</p>}
            </div>
          </div>
          <div className="packing-heading"><h1>PACKING LIST</h1><p>Shipment contents</p></div>
          <dl className="packing-metadata">{(continuation ? metadata.slice(0, 2) : metadata).map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
        </header>
        <div className="packing-parties">
          <section><h2>Recipient</h2><p className="packing-party-name" dir="auto">{form.recipient_name || "—"}</p>
            {!continuation && form.recipient_address && <p className="packing-address" dir="auto">{form.recipient_address}</p>}
            {!continuation && form.recipient_phone && <p>{form.recipient_phone}</p>}{!continuation && form.recipient_email && <p>{form.recipient_email}</p>}
          </section>
          <section><h2>Ship to</h2><p className="packing-address" dir="auto">{form.shipping_address || form.recipient_address || "—"}</p></section>
        </div>
        {page.items.length > 0 && <table className="packing-items">
          <colgroup><col style={{ width: "4%" }} /><col style={{ width: descriptionWidth(form) + "%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
            {form.show_packages && <><col style={{ width: "9%" }} /><col style={{ width: "7%" }} /></>}
            {form.show_net_weight && <><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /></>}
            {form.show_gross_weight && <><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /></>}
          </colgroup>
          <thead><tr><th scope="col">#</th><th scope="col">Description</th><th scope="col" className="packing-numeric">Qty</th><th scope="col">Unit</th>
            {form.show_packages && <><th scope="col">Package type</th><th scope="col" className="packing-numeric">Packages</th></>}
            {form.show_net_weight && <><th scope="col" className="packing-numeric">Net / unit<br />({form.weight_unit})</th><th scope="col" className="packing-numeric">Net total<br />({form.weight_unit})</th></>}
            {form.show_gross_weight && <><th scope="col" className="packing-numeric">Gross / unit<br />({form.weight_unit})</th><th scope="col" className="packing-numeric">Gross total<br />({form.weight_unit})</th></>}
          </tr></thead>
          <tbody>{page.items.map((item, i) => <tr key={`${item.id}-${i}`} data-packing-item={item.id} data-packing-continuation={item.continuation || undefined}>
            <td>{item.sourceIndex + 1}</td><td className="packing-description" dir="auto">{item.continuation && <small>Continued</small>}{item.description || "—"}</td>
            <td className="packing-numeric">{item.continuation ? "—" : displayNumber(item.qty)}</td><td>{item.continuation ? "—" : item.unit || "—"}</td>
            {form.show_packages && <><td>{item.continuation ? "—" : item.package_type || "—"}</td><td className="packing-numeric">{item.continuation ? "—" : displayNumber(item.package_count)}</td></>}
            {form.show_net_weight && <><td className="packing-numeric">{item.continuation ? "—" : displayNumber(item.net_weight)}</td><td className="packing-numeric">{item.continuation || item.net_weight == null ? "—" : displayNumber(item.qty * item.net_weight)}</td></>}
            {form.show_gross_weight && <><td className="packing-numeric">{item.continuation ? "—" : displayNumber(item.gross_weight)}</td><td className="packing-numeric">{item.continuation || item.gross_weight == null ? "—" : displayNumber(item.qty * item.gross_weight)}</td></>}
          </tr>)}</tbody>
        </table>}
        {page.notes && <section className="packing-notes"><h2>{index > 0 && pages[index - 1].notes ? "Notes · continued" : "Notes"}</h2><p dir="auto">{page.notes}</p></section>}
        {!isLast && page.quantities.length > 0 && <section className="packing-quantity-continuation"><h2>Shipment quantities</h2><dl>{page.quantities.map(([unit, qty]) => <div key={unit}><dt>Quantity · {unit}</dt><dd>{displayNumber(qty)}</dd></div>)}</dl></section>}
        {isLast && <>
          <section className="packing-summary" aria-label="Shipment totals"><h2>Shipment totals</h2><dl>{[...page.quantities.map(([unit, qty]) => ["Quantity · " + unit, displayNumber(qty)]), ...summary].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {((form.show_net_weight && form.items.some(item => item.net_weight == null)) || (form.show_gross_weight && form.items.some(item => item.gross_weight == null))) && <p className="packing-weight-note">Weight totals include the weights entered above.</p>}
          </section>
          <div className="packing-signoff"><div><h2>Prepared by</h2><p dir="auto">{form.prepared_by || ""}</p><span>Signature</span></div><div><h2>Received by</h2><p /><span>Name, signature & date</span></div><div><h2>Authorized by</h2><p /><span>Signature & stamp</span></div></div>
        </>}
        <footer className="packing-page-footer"><span>{form.number || "Packing list"}</span><span>Page {index + 1} of {pages.length}</span></footer>
      </div>
    </div>;
  })}</>;
  return documentRef ? <div ref={documentRef} style={{ width: A4_W }}>{sheets}</div> : sheets;
}
