import { FileySpinner as Loader2 } from "./FileySpinner";
import { useState } from "react";
import { Upload, Sparkles, Receipt } from "lucide-react";
import { Modal, Field } from "./ui";
import { SelectMenu } from "./ui-menu";
import { DateField } from "./DatePicker";
import { useUI } from "../lib/ui";
import { extractExpenseFromImage, aiReady, type ExtractedExpense } from "../lib/ai";
import { fileToImages } from "../lib/docScan";
import { fin } from "../lib/api";
import { numInput, todayYmd } from "../lib/format";

/* Scan a receipt with the user's AI model and log it as an expense. */

const CATEGORIES = [
  "Travel",
  "Meals",
  "Office",
  "Software",
  "Utilities",
  "Rent",
  "Other",
];

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
      const imgs = await fileToImages(file);
      setData(await extractExpenseFromImage(imgs));
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
      const today = todayYmd();
      const desc = [data.vendor, data.description].filter(Boolean).join(" - ") || null;
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
        <label className="relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-hover focus-within:ring-2 focus-within:ring-ring">
          {busy ? (
            <Loader2 size={28} className="animate-spin text-primary-500" />
          ) : (
            <Upload size={28} className="text-brand-400" />
          )}
          <span className="text-sm font-medium text-ink">
            {busy
              ? "Reading the receipt…"
              : fileName || "Upload a receipt (PDF or image)"}
          </span>
          <span className="text-xs text-brand-400">
            Your AI model extracts the details - nothing is sent to Filey.
          </span>
          <input
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            aria-label="Upload receipt PDF or image"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-brand-400">
            <Receipt size={14} /> {fileName} - review &amp; save.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor">
              <input
                className="input"
                value={data.vendor ?? ""}
                onChange={(e) => setData({ ...data, vendor: e.target.value })}
              />
            </Field>
            <Field label="Amount">
              <input
                className="input"
                value={String(data.amount ?? "")}
                onChange={(e) => setData({ ...data, amount: numInput(e.target.value) })}
              />
            </Field>
            <Field label="Date">
              <DateField
                value={data.date ?? ""}
                onChange={(v) => setData({ ...data, date: v })}
                clearable={false}
              />
            </Field>
            <Field label="Category">
              <SelectMenu
                ariaLabel="Category"
                value={data.category || "Other"}
                onChange={(v) => setData({ ...data, category: v })}
                options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
          </div>
          <Field label="Note">
            <input
              className="input"
              value={data.description ?? ""}
              onChange={(e) => setData({ ...data, description: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button className="btn-ghost" onClick={reset}>
              Scan another
            </button>
            <button className="btn-primary" onClick={saveExpense} disabled={saving}>
              {saving ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Log expense
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
