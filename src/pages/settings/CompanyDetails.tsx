import { useUI } from "../../lib/ui";
import { billing, CompanyProfile } from "../../lib/api";
import { useEffect, useRef, useState } from "react";
import { FormField } from "../../components/ui";
import {
  Building2,
  Upload,
  X,
  Check,
  Landmark,
  FileText,
  Stamp,
  Hash,
} from "lucide-react";
import { numInput } from "../../lib/format";
import { loadInvoiceFormat, saveInvoiceFormat } from "../../lib/numberFormat";
import { renderPattern, hasCounter } from "../../lib/docNumber";
import { LEGAL_ID_TYPES, EMIRATES, normalizeEmirate } from "../../lib/einvoice";
import {
  loadBankInfo,
  saveBankInfo,
  EMPTY_BANK,
  BANK_FIELDS,
  type BankInfo,
} from "../../components/BankDetails";
import {
  loadLetterhead,
  saveLetterhead,
  EMPTY_LETTERHEAD,
  LetterheadConfig,
  type LetterheadInfo,
} from "../../components/Letterhead";
import {
  loadCompanyStampSig,
  saveCompanyStampSig,
  EMPTY_STAMP_SIG,
  StampSignatureSettings,
  type CompanyStampSig,
} from "../../components/StampSignatureSettings";

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "INR", "SAR"];
const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Private Limited",
  "LLC",
  "Free Zone",
  "Partnership",
  "Public Limited",
];

/** Live preview of the next few numbers a format will produce. */
function numberPreview(fmt: string): string {
  if (!fmt.trim()) return "INV-2026-0001, INV-2026-0002, …";
  if (!hasCounter(fmt)) return "Add a {001} part so a number can count up";
  const m = fmt.match(/\{(\d+)\}/);
  const start = m ? parseInt(m[1], 10) || 1 : 1;
  return [0, 1, 2].map((i) => renderPattern(fmt, start + i)).join(", ") + ", …";
}

/* ---------------- Company Details ---------------- */

export default function CompanyDetails() {
  const { toast } = useUI();
  const [c, setC] = useState<CompanyProfile | null>(null);
  const [bank, setBank] = useState<BankInfo>(EMPTY_BANK);
  const [lh, setLh] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [stampSig, setStampSig] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [numFmt, setNumFmt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setFieldError = (f: string, e: string) =>
    setFieldErrors((p) => (e ? { ...p, [f]: e } : { ...p, [f]: "" }));
  const clearFieldErrors = () => setFieldErrors({});

  useEffect(() => {
    // Normalize legacy AE-xx emirate on load so the dropdown matches and the
    // next save persists the canonical 3-letter code (local data has no SQL migration).
    billing
      .getCompany()
      .then((d) =>
        setC(
          d ? { ...d, country_subdivision: normalizeEmirate(d.country_subdivision) } : d
        )
      )
      .catch(console.error);
    loadBankInfo()
      .then(setBank)
      .catch((e) => console.warn("Failed to load bank details", e));
    loadLetterhead()
      .then(setLh)
      .catch((e) => console.warn("Failed to load letterhead", e));
    loadCompanyStampSig()
      .then(setStampSig)
      .catch((e) => console.warn("Failed to load stamp/signature", e));
    loadInvoiceFormat()
      .then(setNumFmt)
      .catch((e) => console.warn("Failed to load invoice format", e));
  }, []);

  const setBankField = (k: keyof BankInfo, v: string) => {
    setBank((b) => ({ ...b, [k]: v }));
    setSaved(false);
  };

  if (!c) return <div className="card text-sm text-brand-400">Loading…</div>;

  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) => {
    setC({ ...c, [k]: v });
    setSaved(false);
  };

  const onLogo = (file?: File) => {
    if (!file) return;
    // The card promises "max 2MB" but nothing enforced it: the logo is embedded
    // as a data: URL in the company row, so an 8MB photo made the whole save
    // fail with a raw database error and no obvious cause.
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That logo is over 2MB. Pick a smaller image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    clearFieldErrors();
    let hasErr = false;
    if (!c.name?.trim()) {
      setFieldError("name", "Company name is required");
      hasErr = true;
    }
    if (!c.address?.trim()) {
      setFieldError("address", "Address is required");
      hasErr = true;
    }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
      setFieldError("email", "Enter a valid email");
      hasErr = true;
    }
    if (hasErr) return;

    setSaving(true);
    try {
      await billing.saveCompany(c);
      await saveBankInfo(bank);
      await saveLetterhead(lh);
      await saveCompanyStampSig(stampSig);
      await saveInvoiceFormat(numFmt);
      try {
        const fresh = await billing.getCompany();
        setC(fresh);
      } catch (e) {
        console.warn("Failed to load company details after save", e);
        // getCompany falls back to cache — our saved data is there.
      }
      setSaved(true);
      toast.success("Company details saved.");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object"
            ? ((e as any).message ??
              (e as any).details ??
              (e as any).hint ??
              JSON.stringify(e))
            : String(e);
      toast.error(`Could not save company details: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <p className="font-medium text-ink">Company Details</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-5">
        Update your company information. These details appear on invoices, quotations and
        other documents automatically.
      </p>

      <p className="label">Company Logo</p>
      <div className="flex items-center gap-4 mb-5">
        <div className="w-24 h-24 rounded-xl border border-brand-200 bg-brand-50 grid place-items-center overflow-hidden">
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
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Upload Logo
          </button>
          <p className="text-[11px] text-brand-400 mt-1">JPG, PNG or SVG · max 2MB</p>
          {c.logo && (
            <button
              className="text-[11px] font-medium text-danger mt-1 cursor-pointer"
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
        <FormField label="Company Name" error={fieldErrors.name} required>
          <input
            className="input"
            value={c.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (fieldErrors.name) setFieldError("name", "");
            }}
          />
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Business Type">
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
          </FormField>
          <FormField label="TRN (Tax Registration Number)" hint="15-digit number">
            <input
              className="input"
              placeholder="100000000000003"
              value={c.trn ?? ""}
              onChange={(e) => set("trn", e.target.value)}
            />
          </FormField>
        </div>
        {/* UAE e-invoice: seller legal registration + emirate (entered once). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Legal Registration ID"
            hint="Trade license / EID / passport no."
          >
            <input
              className="input"
              placeholder="CN-1234567"
              value={c.legal_id ?? ""}
              onChange={(e) => set("legal_id", e.target.value)}
            />
          </FormField>
          <FormField label="ID Type" hint="UAE e-invoice">
            <select
              className="select"
              value={c.legal_id_type ?? ""}
              onChange={(e) => set("legal_id_type", e.target.value)}
            >
              <option value="">Select…</option>
              {LEGAL_ID_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Emirate" hint="Country subdivision">
            <select
              className="select"
              value={c.country_subdivision ?? ""}
              onChange={(e) => set("country_subdivision", e.target.value)}
            >
              <option value="">Select…</option>
              {EMIRATES.map((em) => (
                <option key={em.code} value={em.code}>
                  {em.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField
          label="WhatsApp number"
          hint="The number customers message — often not the same as your phone"
        >
          <input
            className="input"
            inputMode="tel"
            placeholder="+971 52 950 5734"
            value={c.whatsapp ?? ""}
            onChange={(e) => set("whatsapp", e.target.value)}
          />
        </FormField>
        {/* Employer half of a UAE WPS salary file. Blank unless payroll is
            filed through WPS — nothing else reads these. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="MOHRE establishment ID"
            hint="13 digits — for the WPS salary file"
          >
            <input
              className="input"
              inputMode="numeric"
              placeholder="1234567890123"
              value={c.mol_establishment_id ?? ""}
              onChange={(e) => set("mol_establishment_id", e.target.value)}
            />
          </FormField>
          <FormField
            label="WPS bank routing code"
            hint="9 digits — from your paying bank"
          >
            <input
              className="input"
              inputMode="numeric"
              placeholder="033112345"
              value={c.wps_bank_code ?? ""}
              onChange={(e) => set("wps_bank_code", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Address" error={fieldErrors.address} required>
          <>
            <input
              className="input mb-2"
              placeholder="Street, area"
              value={c.address ?? ""}
              onChange={(e) => {
                set("address", e.target.value);
                if (fieldErrors.address) setFieldError("address", "");
              }}
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
          </>
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Phone Number" hint="+971 50 123 4567">
            <input
              className="input"
              placeholder="+971 50 123 4567"
              value={c.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </FormField>
          <FormField
            label="Email Address"
            error={fieldErrors.email}
            hint="hello@company.com"
          >
            <input
              className="input"
              placeholder="hello@company.com"
              value={c.email ?? ""}
              onChange={(e) => {
                set("email", e.target.value);
                if (fieldErrors.email) setFieldError("email", "");
              }}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Website" hint="www.company.com">
            <input
              className="input"
              placeholder="www.company.com"
              value={c.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
            />
          </FormField>
          <FormField label="Currency">
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
          </FormField>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-medium text-ink">Tax Information</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Select how tax is applied to your transactions
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Tax Type">
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
          </FormField>
          <FormField label="VAT Registration Number">
            <input
              className="input"
              value={c.vat_number ?? ""}
              onChange={(e) => set("vat_number", e.target.value)}
            />
          </FormField>
          <FormField label="Default Tax Rate (%)" hint="e.g. 5">
            <input
              type="number"
              className="input"
              placeholder="5"
              value={c.default_tax_rate ?? ""}
              onChange={(e) => set("default_tax_rate", numInput(e.target.value))}
            />
          </FormField>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-medium text-ink flex items-center gap-2">
          <Stamp size={16} /> Stamp & Signature
        </p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Upload once here. Then toggle “Stamp” and “Signature” on any invoice, quotation,
          purchase order, declaration letter or delivery challan to print them.
        </p>
        <StampSignatureSettings
          value={stampSig}
          onChange={(next) => {
            setStampSig(next);
            setSaved(false);
          }}
        />
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-medium text-ink flex items-center gap-2">
          <Landmark size={16} /> Bank Details
        </p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Enter once here. Then toggle “Show bank details” on any invoice, quotation or
          other document to print them.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {BANK_FIELDS.map((f) => (
            <FormField key={f.key} label={f.label}>
              <input
                className="input"
                placeholder={f.placeholder}
                value={bank[f.key] ?? ""}
                onChange={(e) => setBankField(f.key, e.target.value)}
              />
            </FormField>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-medium text-ink flex items-center gap-2">
          <FileText size={16} /> Letterhead
        </p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Upload your full A4 letterhead (logo, header and footer artwork on one page).
          Toggle “Use letterhead” on an LPO, declaration letter or other document to print
          the body on top of it — then adjust the header and footer spacing on that
          document so the text clears your artwork.
        </p>
        <LetterheadConfig
          value={lh}
          onChange={(next) => {
            setLh(next);
            setSaved(false);
          }}
        />
      </div>

      <div className="mt-6 pt-5 border-t border-brand-100">
        <p className="font-medium text-ink flex items-center gap-2">
          <Hash size={16} /> Invoice Numbering
        </p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Set how new invoice numbers are generated. Put the part that should count up
          inside braces — its digits set the width and the starting value, so{" "}
          <span className="font-mono">{"{001}"}</span> means 001, 002, 003… Everything
          outside the braces stays fixed. Use <span className="font-mono">{"{YY}"}</span>{" "}
          or <span className="font-mono">{"{YYYY}"}</span> for the year. Leave blank to
          keep the default INV-2026-0001 scheme.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Format">
            <input
              className="input font-mono"
              placeholder="INV-DLS-{001}-26"
              value={numFmt}
              onChange={(e) => {
                setNumFmt(e.target.value);
                setSaved(false);
              }}
            />
          </FormField>
          <FormField label="Preview — your next invoices">
            <div className="input flex items-center font-mono text-brand-500 bg-brand-50 dark:bg-white/5">
              {numberPreview(numFmt)}
            </div>
          </FormField>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6">
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
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
