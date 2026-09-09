import { memo, useLayoutEffect, useRef, useState } from "react";
import TemplateBackground from "./TemplateBackground";
import DocView, { type DocViewForm } from "./DocView";
import { DOC_TEMPLATES, type DocType } from "./DocTemplates";
import type { CustomTemplate } from "./TemplateDesigner";
import "./TemplateTilePreview.css";

const TITLES: Record<DocType, string> = { invoice: "INVOICE", quote: "QUOTATION", po: "PURCHASE ORDER", receipt: "PAYMENT RECEIPT" };

/** Use the real renderer at the full paper ratio, without stretching or cropping. */
export default memo(function TemplateTilePreview({ templateId, customTemplates, docType }: {
  templateId: string;
  customTemplates: CustomTemplate[];
  docType?: DocType;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(130);
  const custom = customTemplates.find((template) => template.id === templateId);
  const paperWidth = custom?.paperSize === "Letter" ? 816 : 794;
  const paperHeight = custom?.paperSize === "Letter" ? 1056 : 1122;
  const type = docType || (DOC_TEMPLATES.find((template) => template.id === templateId)?.docTypes[0] ?? "invoice");

  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const measure = () => { const next = element.clientWidth; if (next > 0) setWidth(next); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const form: DocViewForm = {
    template: templateId, accent: custom?.accent || "#252525", currency: "AED", tax_country_code: "AE",
    doc_title: TITLES[type], number: "EXAMPLE-001", seller_name: "Your company", seller_address: "Business address · City",
    seller_trn: "100000000000003", customer_name: type === "po" ? "Supplier company" : "Customer company",
    customer_address: "Company address · City", issue_date: "2026-01-15", due_date: "2026-02-14", tax_rate: type === "receipt" ? 0 : 5,
    notes: "Thank you for your business.", terms: type === "receipt" ? "Payment received with thanks." : "Payment due within 30 days.",
    payment_method: "Bank transfer", ref_number: "PAY-001", amount_words: "Two thousand five hundred dirhams only",
    items: type === "receipt" ? [{ description: "Payment received", qty: 1, unit_price: 2500 }] : [
      { description: "Professional services", qty: 2, unit_price: 750, unit: "Service" },
      { description: "Project materials", qty: 4, unit_price: 125, unit: "Unit" },
      { description: "Delivery and installation", qty: 1, unit_price: 500, unit: "Service" },
    ],
  };

  return (
    <div ref={wrapper} aria-hidden="true" className="template-preview-paper pointer-events-none relative w-full min-w-0 overflow-hidden rounded-md border border-black/10 text-neutral-900 select-none"
      style={{ aspectRatio: paperWidth + " / " + paperHeight, colorScheme: "light", backgroundColor: "#fff" }}>
      {custom?.type === "file" ? (
        <TemplateBackground data={custom.fileData || ""} type={custom.fileType || "image"} />
      ) : (
        <div className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white p-12" style={{ width: paperWidth, height: paperHeight, transform: "scale(" + width / paperWidth + ")", fontFamily: custom?.font || "'Plus Jakarta Sans', system-ui, sans-serif" }}>
          <DocView form={form} customTemplate={custom} labels={{ docTitle: TITLES[type], partyLabel: type === "po" ? "Supplier" : type === "receipt" ? "Received from" : "Bill to", totalLabel: type === "receipt" ? "Amount received" : "Total" }} />
        </div>
      )}
    </div>
  );
});
