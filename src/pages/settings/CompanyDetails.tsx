import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import CountryTaxFields from "../../components/CountryTaxFields";
import { taxRegimeFor, taxIdError, isUaeRegime } from "../../lib/taxRegimes";
import { CURRENCIES } from "../../lib/format";
import { useUI } from "../../lib/ui";
import { billing, CompanyProfile } from "../../lib/api";
import { useEffect, useRef, useState } from "react";
import { FormField } from "../../components/ui";
import { SelectMenu } from "../../components/ui-menu";
import { Building2, Upload, X, Check } from "lucide-react";
import { DocPresetsPanel } from "../../components/DocPresetBar";
import {
  DOC_NUMBER_KINDS,
  loadDocFormats,
  saveDocFormat,
  type DocFormats,
} from "../../lib/numberFormat";
import { renderPattern, hasCounter } from "../../lib/docNumber";
import { LEGAL_ID_TYPES, EMIRATES, normalizeEmirate } from "../../lib/einvoice";
import {
  loadBankInfo,
  saveBankInfo,
  EMPTY_BANK,
  bankFields,
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
  const [docFmts, setDocFmts] = useState<DocFormats>({});
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
          d && isUaeRegime(d.currency, d.country_code)
            ? { ...d, country_subdivision: normalizeEmirate(d.country_subdivision) }
            : d
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
    loadDocFormats()
      .then(setDocFmts)
      .catch((e) => console.warn("Failed to load document formats", e));
  }, []);

  /** Format errors for the identifiers this country actually uses. An Indian
   *  IFSC and a UAE IBAN are checked; a field the country does not use is not
   *  validated, and never blocked. */
  const [bankErr, setBankErr] = useState<Partial<Record<keyof BankInfo, string>>>({});

  const setBankField = (k: keyof BankInfo, v: string) => {
    setBank((b) => ({ ...b, [k]: v }));
    setSaved(false);
  };

  const checkBank = (country: string | null | undefined) => {
    const errs: Partial<Record<keyof BankInfo, string>> = {};
    for (const f of bankFields(country)) {
      if (!f.validate) continue;
      const problem = f.validate(bank[f.key] ?? "");
      if (problem) errs[f.key] = problem;
    }
    setBankErr(errs);
    return Object.keys(errs).length === 0;
  };

  if (!c)
    return (
      <SettingsPanel>
        <SettingsSection
          title="Company Details"
          description="Loading your company settings."
        >
          <div className="h-10 animate-pulse rounded-[8px] bg-muted" />
          <div className="h-10 animate-pulse rounded-[8px] bg-muted" />
        </SettingsSection>
      </SettingsPanel>
    );

  const regime = taxRegimeFor(c.currency, c.country_code);
  const uae = isUaeRegime(c.currency, c.country_code);
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
    if (taxIdError(c.trn, c.country_code)) {
      setFieldError("trn", taxIdError(c.trn, c.country_code));
      hasErr = true;
    }
    if (hasErr) return;
    // A mistyped IFSC or IBAN is worth catching here: it is printed on
    // invoices, and the bank rejects it days later when a payment fails.
    if (!checkBank(c.country_code)) return;

    setSaving(true);
    try {
      await billing.saveCompany(c);
      // Bank, letterhead, stamp and doc formats are independent targets —
      // run them in parallel and report which ones failed, rather than
      // aborting on the first error and leaving the user guessing.
      const [bankR, lhR, stampR] = await Promise.allSettled([
        saveBankInfo(bank),
        saveLetterhead(lh),
        saveCompanyStampSig(stampSig),
      ]);
      const fmtResults = await Promise.allSettled(
        DOC_NUMBER_KINDS.filter((spec) => docFmts[spec.kind] !== undefined).map((spec) =>
          saveDocFormat(spec.kind, docFmts[spec.kind]!)
        )
      );
      const failures = [
        ...(bankR.status === "rejected" ? ["bank details"] : []),
        ...(lhR.status === "rejected" ? ["letterhead"] : []),
        ...(stampR.status === "rejected" ? ["stamp/signature"] : []),
        ...fmtResults
          .map((r, i) =>
            r.status === "rejected" ? DOC_NUMBER_KINDS[i].label.toLowerCase() : null
          )
          .filter(Boolean),
      ];
      if (failures.length) {
        toast.error(
          `Saved company details, but these failed: ${failures.join(", ")}. Try saving again.`
        );
      }
      try {
        const fresh = await billing.getCompany();
        setC(fresh);
      } catch (e) {
        console.warn("Failed to load company details after save", e);
      }
      setSaved(true);
      if (!failures.length) toast.success("Company details saved.");
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
    <SettingsPanel>
      <SettingsSection
        title="Company logo"
        description="Your logo appears on invoices, quotations and other documents."
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl border border-border bg-muted grid place-items-center overflow-hidden">
            {c.logo ? (
              <img
                src={c.logo}
                alt="Company logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <Building2 size={28} className="text-muted-foreground" />
            )}
          </div>
          <div>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Upload Logo
            </button>
            <p className="text-[11px] text-muted-foreground mt-1">
              JPG, PNG or SVG · max 2MB
            </p>
            {c.logo && (
              <button
                className="btn-ghost text-danger mt-2"
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
      </SettingsSection>
      <SettingsSection
        title="Company Details"
        description="Business information used across your workspace and documents."
      >
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
            <SelectMenu
              value={c.business_type ?? ""}
              onChange={(v) => set("business_type", v)}
              options={[
                { value: "", label: "Select…" },
                ...BUSINESS_TYPES.map((b) => ({ value: b, label: b })),
              ]}
            />
          </FormField>
          <FormField label={regime.trnLabel} error={fieldErrors.trn}>
            <input
              className="input"
              placeholder={regime.trnLabel}
              value={c.trn ?? ""}
              onChange={(e) => {
                setC({ ...c, trn: e.target.value, vat_number: e.target.value });
                setSaved(false);
              }}
            />
          </FormField>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Contact & address"
        description="How customers can reach your company."
      >
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
                aria-label="City, Country"
                placeholder="City, Country"
                value={c.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
              />
              <input
                className="input"
                aria-label="Zip / Postal Code"
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
        <div>
          <FormField label="Website" hint="www.company.com">
            <input
              className="input"
              placeholder="www.company.com"
              value={c.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
            />
          </FormField>
        </div>{" "}
        <FormField
          label="WhatsApp number"
          hint="The number customers message - often not the same as your phone"
        >
          <input
            className="input"
            inputMode="tel"
            placeholder="+971 52 950 5734"
            value={c.whatsapp ?? ""}
            onChange={(e) => set("whatsapp", e.target.value)}
          />
        </FormField>
      </SettingsSection>
      <SettingsSection
        title="Tax Information"
        description="Choose your business country and defaults for new documents."
      >
        <CountryTaxFields
          company={c}
          onChange={(next) => {
            setC(next);
            setSaved(false);
          }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {" "}
          <FormField label="Currency">
            <SelectMenu
              value={c.currency ?? "AED"}
              onChange={(v) => set("currency", v)}
              options={CURRENCIES.map((cur) => ({
                value: cur.code,
                label: `${cur.code} — ${cur.name}`,
              }))}
            />
          </FormField>{" "}
          <FormField label="Tax collection">
            <SelectMenu
              value={c.tax_type === "None" ? "none" : "rates"}
              onChange={(v) => {
                setC({
                  ...c,
                  tax_type: v === "none" ? "None" : regime.taxLabel,
                  default_tax_rate: v === "none" ? 0 : c.default_tax_rate,
                });
                setSaved(false);
              }}
              options={[
                { value: "rates", label: "Use default and line rates" },
                { value: "none", label: "No tax on new documents" },
              ]}
            />
          </FormField>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Registration & payroll"
        description="Legal registration details and country-specific payroll settings."
      >
        {/* UAE e-invoice: seller legal registration + emirate (entered once). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Legal Registration ID"
            hint={
              uae ? "Trade license / EID / passport no." : "Company registration number"
            }
          >
            <input
              className="input"
              placeholder="CN-1234567"
              value={c.legal_id ?? ""}
              onChange={(e) => set("legal_id", e.target.value)}
            />
          </FormField>
          {uae && (
            <FormField label="ID Type" hint="UAE e-invoice">
              <SelectMenu
                value={c.legal_id_type ?? ""}
                onChange={(v) => set("legal_id_type", v)}
                options={[
                  { value: "", label: "Select…" },
                  ...LEGAL_ID_TYPES.map((t) => ({ value: t.code, label: t.label })),
                ]}
              />
            </FormField>
          )}
          <FormField label={uae ? "Emirate" : "State / Province"}>
            {uae ? (
              <SelectMenu
                value={c.country_subdivision ?? ""}
                onChange={(v) => set("country_subdivision", v)}
                options={[
                  { value: "", label: "Select…" },
                  ...EMIRATES.map((em) => ({ value: em.code, label: em.label })),
                ]}
              />
            ) : (
              <input
                className="input"
                value={c.country_subdivision || ""}
                onChange={(e) => set("country_subdivision", e.target.value)}
              />
            )}
          </FormField>
        </div>
        {/* WPS is specific to UAE payroll. */}
        {uae && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              label="MOHRE establishment ID"
              hint="13 digits - for the WPS salary file"
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
              hint="9 digits - from your paying bank"
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
        )}
      </SettingsSection>
      <SettingsSection
        title="Document Presets"
        description="Choose the starting template for each document type. Preset changes save immediately."
      >
        <DocPresetsPanel />
      </SettingsSection>
      <SettingsSection
        title="Stamp & Signature"
        description="Upload once, then turn on the stamp or signature in any document."
      >
        <StampSignatureSettings
          value={stampSig}
          onChange={(next) => {
            setStampSig(next);
            setSaved(false);
          }}
        />
      </SettingsSection>
      <SettingsSection
        title="Bank Details"
        description="Payment details you can include on invoices and other documents."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bankFields(c.country_code).map((f) => (
            <FormField
              key={f.key}
              label={f.label}
              error={bankErr[f.key] || undefined}
            >
              <input
                className="input"
                placeholder={f.placeholder}
                value={bank[f.key] ?? ""}
                onChange={(e) => {
                  setBankField(f.key, e.target.value);
                  if (bankErr[f.key]) setBankErr((prev) => ({ ...prev, [f.key]: "" }));
                }}
              />
            </FormField>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Letterhead"
        description="Upload an A4 page with your header and footer. Adjust body spacing in the document editor."
      >
        <LetterheadConfig
          value={lh}
          onChange={(next) => {
            setLh(next);
            setSaved(false);
          }}
        />
      </SettingsSection>
      <SettingsSection
        title="Document Numbering"
        description="Use {001} for a counter and {YY} or {YYYY} for the year. Leave a format empty to use its default."
      >
        <div className="space-y-3">
          {DOC_NUMBER_KINDS.map((spec) => (
            <div key={spec.kind} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={spec.label}>
                <input
                  className="input font-mono"
                  placeholder={spec.placeholder}
                  value={docFmts[spec.kind] ?? ""}
                  onChange={(e) => {
                    setDocFmts((f) => ({ ...f, [spec.kind]: e.target.value }));
                    setSaved(false);
                  }}
                />
              </FormField>
              <FormField label="Preview">
                <div className="flex min-h-10 items-center break-all font-mono text-xs text-muted-foreground">
                  {(docFmts[spec.kind] ?? "").trim()
                    ? numberPreview(docFmts[spec.kind] ?? "")
                    : `${spec.prefix}-0001, ${spec.prefix}-0002, …`}
                </div>
              </FormField>
            </div>
          ))}
        </div>
      </SettingsSection>
      <div className="flex flex-wrap items-center justify-end gap-3 p-5 sm:p-6">
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
            <Check size={15} /> Saved - applied to all documents
          </span>
        )}
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </SettingsPanel>
  );
}
