import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Sparkles, Loader2, FileText } from "lucide-react";
import { Modal } from "./ui";
import { useUI } from "../lib/ui";
import { extractInvoiceFromImage, aiReady, type ExtractedInvoice } from "../lib/ai";
import { fileToImage } from "../lib/docScan";
import { billing, type InvoiceDocInput, type InvoiceItem } from "../lib/api";
import { getDisplayCurrency, numInput } from "../lib/format";

/* Scan an invoice/receipt with the user's AI model and create a draft. */

export default function ScanDocModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useUI();
  const navigate = useNavigate();
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [data, setData] = useState<ExtractedInvoice | null>(null);

  const reset = () => {
    setFileName("");
    setData(null);
    setBusy(false);
    setCreating(false);
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!aiReady()) {
      toast.error("Connect an AI model first (Settings → AI Assistant). A vision-capable model is required.");
      return;
    }
    setFileName(file.name);
    setData(null);
    setBusy(true);
    try {
      const img = await fileToImage(file);
      const extracted = await extractInvoiceFromImage(img);
      setData(extracted);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchItem = (i: number, patch: Partial<InvoiceItem>) =>
    setData((d) =>
      d ? { ...d, items: (d.items ?? []).map((it, idx) => (idx === i ? { ...it, ...patch } : it)) } : d
    );

  const createDraft = async () => {
    if (!data) return;
    setCreating(true);
    try {
      const co = await billing.getCompany().catch(() => null);
      const today = new Date().toISOString().slice(0, 10);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const input: InvoiceDocInput = {
        number: `DRAFT-${stamp}`,
        status: "draft",
        template: co?.default_template || "classic",
        accent: co?.default_accent || "#FFD600",
        currency: data.currency || getDisplayCurrency(),
        seller_name: co?.name || "",
        seller_address: co?.address,
        seller_trn: co?.trn,
        seller_email: co?.email,
        seller_phone: co?.phone,
        logo: co?.logo,
        customer_name: data.customer_name || "",
        customer_address: data.customer_address,
        customer_trn: data.customer_trn,
        issue_date: data.issue_date || today,
        due_date: data.due_date,
        notes: data.notes,
        tax_rate: co?.default_tax_rate ?? 0,
        discount: 0,
        items: (data.items ?? []).map((it) => ({
          description: it.description || "",
          qty: Number(it.qty) || 1,
          unit_price: Number(it.unit_price) || 0,
        })),
      };
      await billing.saveDoc(input);
      toast.success("Draft invoice created from the document");
      onClose();
      reset();
      navigate("/invoicing");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Scan a document with AI"
    >
      {!data ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 px-6 py-10 text-center transition-colors hover:bg-brand-50 dark:hover:bg-white/5">
            {busy ? (
              <Loader2 size={28} className="animate-spin text-primary-500" />
            ) : (
              <Upload size={28} className="text-brand-400" />
            )}
            <span className="text-sm font-semibold text-ink">
              {busy ? "Reading the document…" : fileName || "Upload a PDF or image"}
            </span>
            <span className="text-xs text-brand-400">
              Your AI model extracts the fields — nothing is sent to Filey.
            </span>
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-brand-400">
            <FileText size={14} /> {fileName} — review &amp; edit, then create the draft.
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Customer">
              <input
                className="input"
                value={data.customer_name ?? ""}
                onChange={(e) => setData({ ...data, customer_name: e.target.value })}
              />
            </Labeled>
            <Labeled label="Customer TRN">
              <input
                className="input"
                value={data.customer_trn ?? ""}
                onChange={(e) => setData({ ...data, customer_trn: e.target.value })}
              />
            </Labeled>
            <Labeled label="Issue date">
              <input
                type="date"
                className="input"
                value={data.issue_date ?? ""}
                onChange={(e) => setData({ ...data, issue_date: e.target.value })}
              />
            </Labeled>
            <Labeled label="Due date">
              <input
                type="date"
                className="input"
                value={data.due_date ?? ""}
                onChange={(e) => setData({ ...data, due_date: e.target.value })}
              />
            </Labeled>
          </div>

          <div className="space-y-2">
            <p className="label">Line items</p>
            {items.length === 0 && (
              <p className="text-xs text-brand-400">No line items detected.</p>
            )}
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  value={it.description}
                  placeholder="Description"
                  onChange={(e) => patchItem(i, { description: e.target.value })}
                />
                <input
                  className="input w-16"
                  value={String(it.qty)}
                  onChange={(e) => patchItem(i, { qty: numInput(e.target.value) })}
                />
                <input
                  className="input w-24"
                  value={String(it.unit_price)}
                  onChange={(e) => patchItem(i, { unit_price: numInput(e.target.value) })}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={reset}>
              Scan another
            </button>
            <button className="btn-primary" onClick={createDraft} disabled={creating}>
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Create draft invoice
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
