// The invoice as real A4 sheets — the single source of what a PDF contains.
//
// This used to live inline in the Invoicing editor, which meant a PDF could
// only be produced while the editor was open. Sending an invoice from a list
// row had no rendered document to capture, so those emails went out as a
// summary with no attachment. Keeping it in one component lets the editor
// mount it off-screen as before AND lets renderInvoicePdf() mount it headlessly.

import DocView from "./DocView";
import { StampSignatureLayer } from "./StampSignature";
import type { BankInfo } from "./BankDetails";
import { EMPTY_STAMP_SIG, type CompanyStampSig } from "./StampSignatureSettings";
import { paginateItems, type DocItem } from "../lib/docItems";
import { InvoiceElectronicDetailsPage, invoiceElectronicDetailPages } from "./InvoiceElectronicDetails";
import type { DocViewForm } from "./DocView";

/** A4 at 96 CSS dpi. The capture pipeline assumes these exact numbers. */
export const A4_W = 794;
export const A4_H = 1123;

export interface InvoiceExportForm {
  tax_country_code?: string | null;
  items: DocItem[];
  show_stamp?: boolean;
  show_signature?: boolean;
  show_bank?: boolean;
  stamp?: { data?: string } | null;
  signature?: { data?: string } | null;
  accent?: string | null;
  [k: string]: unknown;
}

export default function InvoiceExportSheet({
  form,
  companyStampSig = EMPTY_STAMP_SIG,
  bank,
}: {
  form: InvoiceExportForm;
  companyStampSig?: CompanyStampSig;
  bank: BankInfo;
}) {
  const pages = paginateItems(form.items);
  const detailPages = invoiceElectronicDetailPages(form as unknown as DocViewForm);
  return (
    <>
      {pages.map((group, gi) => {
        const startIdx = pages.slice(0, gi).reduce((n, g) => n + g.length, 0);
        const isLast = gi === pages.length - 1;
        return (
          <div
            key={gi}
            className="invoice-print"
            style={{
              width: A4_W,
              height: A4_H,
              background: "#fff",
              position: "relative",
              overflow: "hidden",
              padding: 48,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                minHeight: 1027,
                background: "#fff",
              }}
            >
              {isLast && (
                <StampSignatureLayer
                  stamp={
                    form.show_stamp
                      ? form.stamp?.data
                        ? (form.stamp as never)
                        : (companyStampSig ?? EMPTY_STAMP_SIG).stamp
                      : undefined
                  }
                  signature={
                    form.show_signature
                      ? form.signature?.data
                        ? (form.signature as never)
                        : (companyStampSig ?? EMPTY_STAMP_SIG).signature
                      : undefined
                  }
                  onStampMove={() => {}}
                  onSignatureMove={() => {}}
                />
              )}
              <DocView
                form={form as never}
                pageItems={group}
                itemStartIndex={startIdx}
                showTotals={isLast}
                showFooter={isLast}
                bank={form.show_bank ? bank : undefined}
              />
            </div>
          </div>
        );
      })}
      {detailPages.map((rows, index) => <div key={`electronic-${index}`} className="invoice-print" data-einvoice-details-sheet
        style={{ width: A4_W, height: A4_H, background: "#fff", position: "relative", padding: 48, boxSizing: "border-box" }}>
        <InvoiceElectronicDetailsPage rows={rows} pageNumber={index + 1} pageCount={detailPages.length} invoiceNumber={typeof form.number === "string" ? form.number : undefined} />
      </div>)}
    </>
  );
}
