import { useState } from "react";
import { Upload, Sparkles, Loader2, Receipt } from "lucide-react";
import { Modal } from "./ui";
import { useUI } from "../lib/ui";
import { extractExpenseFromImage, aiReady, type ExtractedExpense } from "../lib/ai";
import { fileToImage } from "../lib/docScan";
import { fin } from "../lib/api";
import { numInput } from "../lib/format";

/* Scan a receipt with the user's AI model and log it as an expense. */

const CATEGORIES = ["Travel", "Meals", "Office", "Software", "Utilities", "Rent", "Other"];

export default function ExpenseScanModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useUI();
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ExtractedExpense | null>(null);

  const reset = () => {
    setFileName("");
    setData(null);
    setBusy(false);
    setSaving(false);
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!aiReady()) {
      toast.error("Connect a vision-capable AI model first (Settings → AI Assistant).");
      return;
    }
    setFileName(file.name);
    setData(null);
    setBusy(true);
    try {
      const img = await fileToImage(file);
      setData(await extractExpenseFromImage(img));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveExpense = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const desc = [data.vendor, data.description].filter(Boolean).join(" — ") || null;
      await fin.createExpense(
        data.category || "Other",
        desc,
        Number(data.amount) || 0,
        data.date || today,
        null
      );
      toast.success("Expense logged from receipt");
      onSaved?.();
      onClose();
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Scan a receipt with AI"
    >
      {!data ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 px-6 py-10 text-center transition-colors hover:bg-brand-50 dark:hover:bg-white/5">
          {busy ? (
            <Loader2 size={28} className="animate-spin text-primary-500" />
          ) : (
            <Upload size={28} className="text-brand-400" />
          )}
          <span className="text-sm font-semibold text-ink">
            {busy ? "Reading the receipt…" : fileName || "Upload a receipt (PDF or image)"}
          </span>
          <span className="text-xs text-brand-400">
            Your AI model extracts the details — nothing is sent to Filey.
          </span>
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-brand-400">
            <Receipt size={14} /> {fileName} — review &amp; save.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Vendor">
              <input
                className="input"
                value={data.vendor ?? ""}
                onChange={(e) => setData({ ...data, vendor: e.target.value })}
              />
            </Labeled>
            <Labeled label="Amount">
              <input
                className="input"
                value={String(data.amount ?? "")}
                onChange={(e) => setData({ ...data, amount: numInput(e.target.value) })}
              />
            </Labeled>
            <Labeled label="Date">
              <input
                type="date"
                className="input"
                value={data.date ?? ""}
                onChange={(e) => setData({ ...data, date: e.target.value })}
              />
            </Labeled>
            <Labeled label="Category">
              <select
                className="select"
                value={data.category || "Other"}
                onChange={(e) => setData({ ...data, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
          <Labeled label="Note">
            <input
              className="input"
              value={data.description ?? ""}
              onChange={(e) => setData({ ...data, description: e.target.value })}
            />
          </Labeled>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={reset}>
              Scan another
            </button>
            <button className="btn-primary" onClick={saveExpense} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Log expense
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
