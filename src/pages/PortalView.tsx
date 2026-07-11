import { useEffect, useState } from "react";
import { supabase, invokeFn } from "../lib/supabase";
import { money } from "../lib/format";
import DocView, { type DocViewForm, type DocViewLabels } from "../components/DocView";
import { splitItemMeta } from "../lib/docItems";


/* Public, unauthenticated document viewer for shared links.
 * Route: #/portal/<share_token>
 * Reads through the SECURITY DEFINER get_shared_doc() RPC, which only returns
 * documents the owner has explicitly shared (shared = true). */

interface SharedDoc {
  doc_type: "invoice" | "quotation" | "purchase_order" | "receipt";
  doc: Record<string, unknown>;
  items: { description: string; qty: number; unit_price: number; unit?: string; discount?: number; tax?: number; custom?: Record<string, string> }[];
}

function tokenFromHash(): string {
  const m = window.location.hash.match(/#\/portal\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export default function PortalView() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [shared, setShared] = useState<SharedDoc | null>(null);
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const paid = typeof window !== "undefined" && window.location.hash.includes("paid=1");

  useEffect(() => {
    const token = tokenFromHash();
    if (!supabase || !token) {
      setState("error");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_shared_doc", { p_token: token });
        if (error || !data) {
          setState("error");
          return;
        }
        setShared(data as SharedDoc);
        setState("ok");
      } catch (e) {
        console.warn("Failed to load shared document", e);
        setState("error");
      }
    })();
  }, []);

  const pay = async () => {
    if (!supabase || !shared || shared.doc_type !== "invoice") return;
    setPaying(true);
    setPayErr(null);
    try {
      const { data, error } = (await invokeFn(supabase, "stripe", {
        body: { action: "pay_invoice", token: tokenFromHash() },
      })) as { data: { url?: string; error?: string } | null; error: { message: string } | null };
      const res = data;
      if (error || !res?.url)
        throw new Error(res?.error || error?.message || "Payment is not available yet.");
      window.location.href = res.url;
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
      setPaying(false);
    }
  };

  if (state === "loading")
    return (
      <div className="grid min-h-screen place-items-center bg-[#F7F3EA] dark:bg-[#1C1C1E] text-sm font-medium text-brand-500">
        Loading document…
      </div>
    );

  if (state === "error" || !shared)
    return (
      <div className="grid min-h-screen place-items-center bg-[#F7F3EA] dark:bg-[#1C1C1E] px-6 text-center">
        <div>
          <p className="text-lg font-medium text-ink">Document not available</p>
          <p className="mt-1 text-sm text-brand-500">
            This link is invalid or the document is no longer shared.
          </p>
        </div>
      </div>
    );

  const d = shared.doc;
  const ccy = String(d.currency || "AED");
  const form: DocViewForm = {
    template: String(d.template || "minimal"),
    accent: String(d.accent || "#222222"),
    currency: ccy,
    doc_title: String(d.doc_title || docTitleFor(shared.doc_type)),
    number: String(d.number || ""),
    logo: d.logo ? String(d.logo) : null,
    seller_name: String(d.seller_name || ""),
    seller_address: d.seller_address ? String(d.seller_address) : null,
    seller_trn: d.seller_trn ? String(d.seller_trn) : null,
    seller_email: d.seller_email ? String(d.seller_email) : null,
    seller_phone: d.seller_phone ? String(d.seller_phone) : null,
    customer_name: String(d.customer_name || ""),
    customer_address: d.customer_address ? String(d.customer_address) : null,
    customer_trn: d.customer_trn ? String(d.customer_trn) : null,
    customer_email: d.customer_email ? String(d.customer_email) : null,
    issue_date: d.issue_date ? String(d.issue_date) : null,
    due_date: d.due_date ? String(d.due_date) : null,
    po_number: d.po_number ? String(d.po_number) : null,
    tax_rate: typeof d.tax_rate === "number" ? d.tax_rate : 0,
    discount: typeof d.discount === "number" ? d.discount : 0,
    notes: d.notes ? String(d.notes) : null,
    terms: d.terms ? String(d.terms) : null,
    items: shared.items.map((it) => {
      const { calcMode, amount, itemFormula } = splitItemMeta(it.custom);
      return {
        description: it.description,
        qty: Number(it.qty),
        unit_price: Number(it.unit_price),
        unit: it.unit,
        discount: it.discount,
        tax: it.tax,
        custom: it.custom,
        calcMode,
        amount,
        itemFormula,
      };
    }),
  };

  const labels: DocViewLabels = labelsFor(shared.doc_type);
  const status = String(d.status || "draft");

  return (
    <div className="min-h-screen bg-[#F7F3EA] dark:bg-[#1C1C1E] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-brand-200 dark:border-[#2C2C2E] bg-white dark:bg-[#1C1C1E] p-8 text-ink dark:text-[#F4F5F6]">
        {(paid || status === "paid") && (
          <div className="mb-4 rounded-2xl bg-green-50 dark:bg-green-500/15 px-4 py-2.5 text-sm font-medium text-green-700 dark:text-green-400">
            Payment received — thank you!
          </div>
        )}

        <div className="paper-texture rounded-xl border border-brand-200 p-8 shadow-sm dark:border-[#3A3D45] dark:bg-white min-h-[1123px]">
          <DocView form={form} labels={labels} />
        </div>

        {shared.doc_type === "invoice" && status !== "paid" && !paid && (
          <div className="mt-6 text-center">
            {payErr && <p className="text-sm text-danger mb-2">{payErr}</p>}
            <button
              className="btn-primary"
              disabled={paying}
              onClick={pay}
            >
              {paying ? "Preparing payment…" : `Pay ${money(form.items.reduce((s, i) => s + i.qty * i.unit_price, 0), ccy)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function docTitleFor(type: SharedDoc["doc_type"]): string {
  switch (type) {
    case "quotation":
      return "QUOTATION";
    case "purchase_order":
      return "PURCHASE ORDER";
    case "receipt":
      return "RECEIPT";
    default:
      return "INVOICE";
  }
}

function labelsFor(type: SharedDoc["doc_type"]): DocViewLabels {
  switch (type) {
    case "quotation":
      return { partyLabel: "Quote To", totalLabel: "Total", issuedLabel: "Quote Date", dueLabel: "Valid Until" };
    case "purchase_order":
      return { partyLabel: "Supplier", totalLabel: "Total", issuedLabel: "Order Date", dueLabel: "Expected" };
    case "receipt":
      return { docTitle: "RECEIPT", partyLabel: "Received From", totalLabel: "Amount Received", issuedLabel: "Date", dueLabel: "Date" };
    default:
      return { partyLabel: "Bill To", totalLabel: "Total", issuedLabel: "Issued", dueLabel: "Due" };
  }
}
