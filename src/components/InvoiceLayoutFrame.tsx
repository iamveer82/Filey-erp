import type { CSSProperties, ReactNode } from "react";
import "./InvoiceLayouts.css";

// Saved IDs identify document semantics. These classes only choose composition.
const layouts: Record<string, string> = {
  "uae-full": "masthead table-grid summary-split",
  "uae-simplified": "compact table-open summary-card",
  "uae-reverse": "ledger table-ruled summary-left mono",
  "uae-foreign": "split table-grid summary-strip",
  "uae-export": "docket table-ruled summary-card",
  "uae-mixed": "letterhead table-zebra summary-split",
  "uae-recurring": "banner table-open summary-strip",
  "uae-freelancer": "editorial table-open summary-right",
  "uae-credit-note": "rail table-ruled summary-left",
  "uae-debit-note": "docket table-grid summary-right",
  "uae-summary": "compact table-zebra summary-strip mono",
  "uae-margin": "centered table-open summary-card serif",
  "uae-agent": "editorial table-zebra summary-split",
  "uae-designated": "boxed table-grid summary-strip",
  "uae-deemed": "letterhead table-open summary-left",
  "uae-commercial": "masthead table-ruled summary-right",
  "uae-proforma": "banner table-grid summary-card",
  "uae-construction": "docket table-grid summary-strip mono",
  "uae-rental": "rail table-zebra summary-card",
  "uae-restaurant": "centered table-ruled summary-strip",
  "uae-medical": "letterhead table-ruled summary-card",
  "uae-education": "stacked table-grid summary-right serif",
  "uae-logistics": "ledger table-grid summary-split mono",
  "uae-ecommerce": "banner table-zebra summary-right",
  "uae-hotel": "centered table-open summary-right serif",
  "uae-salon": "editorial table-ruled summary-card serif",
  "uae-garage": "boxed table-zebra summary-left mono",
  "uae-realestate": "rail table-open summary-split serif",
  "uae-amc": "split table-ruled summary-left",
  "uae-event": "stacked table-open summary-card",
  "uae-timesheet": "ledger table-zebra summary-right mono",
  // The same compositions remain available when legacy layouts use a
  // non-UAE jurisdiction; DocView supplies the appropriate country content.
  uae: "letterhead table-grid summary-right",
  "em-uae": "compact table-ruled summary-card",
};

export default function InvoiceLayoutFrame({
  templateId, accent, brand, title, meta, parties, children,
}: {
  templateId: string;
  accent: string;
  brand: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  parties: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`invoice-layout ${layouts[templateId] || "split table-grid summary-right"}`}
      data-invoice-layout={templateId}
      style={{ "--invoice-accent": accent } as CSSProperties}
    >
      <header className="invoice-letterhead">
        <div className="invoice-brand">{brand}</div>
        <div className="invoice-heading">{title}</div>
        <div className="invoice-metadata">{meta}</div>
      </header>
      {parties && <div className="invoice-parties">{parties}</div>}
      {children}
    </div>
  );
}
