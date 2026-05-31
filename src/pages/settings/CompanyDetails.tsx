import { useUI } from "../../lib/ui";
import { billing, CompanyProfile } from "../../lib/api";
import { useEffect, useRef, useState } from "react";
import { Field } from "../../components/ui";
import { Building2, Upload, X, Check } from "lucide-react";
import { numInput } from "../../lib/format";

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "INR", "SAR"];
const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Private Limited",
  "LLC",
  "Free Zone",
  "Partnership",
  "Public Limited",
];

/* ---------------- Company Details ---------------- */

export default function CompanyDetails() {
  const { toast } = useUI();
  const [c, setC] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    billing.getCompany().then(setC).catch(console.error);
  }, []);

  if (!c)
    return <div className="card text-sm text-brand-400">Loading…</div>;

  const set = <K extends keyof CompanyProfile>(
    k: K,
    v: CompanyProfile[K]
  ) => {
    setC({ ...c, [k]: v });
    setSaved(false);
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      await billing.saveCompany(c);
      try {
        const fresh = await billing.getCompany();
        setC(fresh);
      } catch {
        // getCompany falls back to cache — our saved data is there.
      }
      setSaved(true);
      toast.success("Company details saved.");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object"
          ? (e as any).message ??
            (e as any).details ??
            (e as any).hint ??
            JSON.stringify(e)
          : String(e);
      toast.error(`Could not save company details: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const Req = () => <span className="text-danger">*</span>;

  return (
    <div className="card">
      <p className="font-bold text-ink">Company Details</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-5">
        Update your company information. These details appear on invoices,
        quotations and other documents automatically.
      </p>

      <p className="label">Company Logo</p>
      <div className="flex items-center gap-4 mb-5">
        <div className="w-24 h-24 rounded-2xl border border-brand-200 bg-brand-50 grid place-items-center overflow-hidden">
          {c.logo ? (
            <img
              src={c.logo}
              alt="logo"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <Building2 size={28} className="text-brand-300" />
          )}
        </div>
        <div>
          <button
            className="btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> Upload Logo
          </button>
          <p className="text-[11px] text-brand-400 mt-1">
            JPG, PNG or SVG · max 2MB
          </p>
          {c.logo && (
            <button
              className="text-[11px] font-semibold text-danger mt-1 cursor-pointer"
              onClick={() => set("logo", undefined)}
            >
              <X size={11} className="inline" /> Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onLogo(e.target.files?.[0])}
          />
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Company Name *">
          <input
            className="input"
            value={c.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Business Type">
            <select
              className="select"
              value={c.business_type ?? ""}
              onChange={(e) => set("business_type", e.target.value)}
            >
              <option value="">Select…</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <label className="label">
              TRN (Tax Registration Number) <Req />
            </label>
            <input
              className="input"
              placeholder="100000000000003"
              value={c.trn ?? ""}
              onChange={(e) => set("trn", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">
            Address <Req />
          </label>
          <input
            className="input mb-2"
            placeholder="Street, area"
            value={c.address ?? ""}
            onChange={(e) => set("address", e.target.value)}
          />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-2">
            <input
              className="input"
              placeholder="City, Country"
              value={c.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
            <input
              className="input"
              placeholder="Zip / Postal Code"
              value={c.zip ?? ""}
              onChange={(e) => set("zip", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">
              Phone Number <Req />
            </label>
            <input
              className="input"
              placeholder="+971 50 123 4567"
              value={c.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Email Address <Req />
            </label>
            <input
              className="input"
              placeholder="hello@company.com"
              value={c.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Website">
            <input
              className="input"
              placeholder="www.company.com"
              value={c.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <select
              className="select"
              value={c.currency ?? "AED"}
              onChange={(e) => set("currency", e.target.value)}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-bold text-ink">Tax Information</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Select how tax is applied to your transactions
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Tax Type">
            <select
              className="select"
              value={c.tax_type ?? "VAT"}
              onChange={(e) => set("tax_type", e.target.value)}
            >
              {["VAT", "GST", "Sales Tax", "None"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="VAT Registration Number">
            <input
              className="input"
              value={c.vat_number ?? ""}
              onChange={(e) => set("vat_number", e.target.value)}
            />
          </Field>
          <Field label="Default Tax Rate (%)">
            <input
              type="number"
              className="input"
              placeholder="5"
              value={c.default_tax_rate ?? ""}
              onChange={(e) =>
                set("default_tax_rate", numInput(e.target.value))
              }
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6">
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
            <Check size={15} /> Saved — applied to all documents
          </span>
        )}
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
