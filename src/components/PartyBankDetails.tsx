import { useEffect, useState } from "react";
import { Landmark, Check } from "lucide-react";
import { BANK_FIELDS, EMPTY_BANK, type BankInfo } from "./BankDetails";
import { useUI } from "../lib/ui";

/* Editable bank-details section for a single customer or supplier. Reuses the
 * same field set as the company bank details. Saves the whole object back via
 * onSave (the parent persists it on the customer/supplier record). */
export default function PartyBankDetails({
  value,
  onSave,
}: {
  value?: Record<string, string> | null;
  onSave: (bank: Record<string, string>) => Promise<void>;
}) {
  const { toast } = useUI();
  const [bank, setBank] = useState<BankInfo>({ ...EMPTY_BANK, ...(value ?? {}) });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-sync when the parent record changes (e.g. navigating between parties).
  useEffect(() => {
    setBank({ ...EMPTY_BANK, ...(value ?? {}) });
    setSaved(false);
  }, [value]);

  const set = (k: keyof BankInfo, v: string) => {
    setBank((b) => ({ ...b, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Drop empty fields so a blank section doesn't store noise.
      const trimmed = Object.fromEntries(
        Object.entries(bank).filter(([, v]) => (v ?? "").trim())
      );
      await onSave(trimmed);
      setSaved(true);
      toast.success("Bank details saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save bank details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <p className="font-semibold text-ink flex items-center gap-2">
        <Landmark size={16} /> Bank Details
      </p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Save this party's bank account for payments and reference.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BANK_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label className="label">{f.label}</label>
            <input
              className="input"
              placeholder={f.placeholder}
              value={bank[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 mt-4">
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
            <Check size={15} /> Saved
          </span>
        )}
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Bank Details"}
        </button>
      </div>
    </div>
  );
}
