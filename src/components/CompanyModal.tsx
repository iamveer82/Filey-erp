import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Modal, Field } from "./ui";
import { billing, type CompanyProfile } from "../lib/api";
import { errMsg } from "../lib/format";
import { useUI } from "../lib/ui";
import { DOC_TEMPLATES } from "../lib/docTemplates";
import { loadCustomTemplates } from "./TemplateDesigner";
import { templatesForDocType, type DocType } from "./DocTemplates";
import {
  loadDocPresets,
  saveDocPreset,
  presetTemplate,
  DOC_TYPE_LABELS,
} from "../lib/docPresets";
import { SelectMenu } from "./ui-menu";

/** The company-details dialog behind every document section's "Company"
 *  button. Invoicing, Quoting and Purchase Orders each carried their own copy
 *  of this form, which is how they drifted apart — different fields, different
 *  labels, and no company button at all on receipts and challans. One copy now,
 *  so every section opens the same dialog.
 *
 *  Pass `docType` and the dialog also carries that section's default-template
 *  preset — the Company button is then the whole preset surface, and the old
 *  elongated preset bar above each list is gone. */
export default function CompanyModal({
  open,
  company,
  onClose,
  onSaved,
  docType,
}: {
  open: boolean;
  company: CompanyProfile;
  onClose: () => void;
  onSaved: (c: CompanyProfile) => void;
  docType?: DocType;
}) {
  const { toast } = useUI();
  const [c, setC] = useState<CompanyProfile>(company);
  const [preset, setPreset] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setC(company);
  }, [open, company]);

  useEffect(() => {
    if (open && docType) {
      loadDocPresets()
        .then((p) =>
          setPreset(
            presetTemplate(
              p,
              docType,
              company.default_template,
              templatesForDocType(docType)[0]?.id ?? "minimal"
            )
          )
        )
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docType]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setC({ ...c, logo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const save = async () => {
    try {
      if (docType && preset) await saveDocPreset(docType, preset);
      await billing.saveCompany(c);
      // Re-fetch so the page applies exactly what the server persisted (server
      // defaults, RLS-trimmed columns) and not just the locally-edited copy.
      let fresh: CompanyProfile;
      try {
        fresh = await billing.getCompany();
      } catch {
        fresh = c; // server unreachable - use what we saved
      }
      onSaved(fresh);
      toast.success("Company details saved.");
    } catch (e) {
      toast.error(`Could not save company details: ${errMsg(e)}`);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Company Profile">
      <div className="space-y-3">
        <Field label="Company Name">
          <input
            className="input"
            value={c.name}
            onChange={(e) => setC({ ...c, name: e.target.value })}
          />
        </Field>
        <Field label="Address">
          <input
            className="input"
            value={c.address ?? ""}
            onChange={(e) => setC({ ...c, address: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TRN">
            <input
              className="input"
              value={c.trn ?? ""}
              onChange={(e) => setC({ ...c, trn: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={c.phone ?? ""}
              onChange={(e) => setC({ ...c, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            className="input"
            value={c.email ?? ""}
            onChange={(e) => setC({ ...c, email: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default Template">
            <SelectMenu
              value={c.default_template}
              onChange={(v) => setC({ ...c, default_template: v })}
              options={[
                ...DOC_TEMPLATES,
                ...loadCustomTemplates().map((t) => ({ id: t.id, name: t.name })),
              ].map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
          <Field label="Default Accent">
            <input
              type="color"
              className="input h-[38px] p-1"
              value={c.default_accent}
              onChange={(e) => setC({ ...c, default_accent: e.target.value })}
            />
          </Field>
        </div>
        {docType && (
          <Field
            label={`Default template for new ${DOC_TYPE_LABELS[docType].toLowerCase()}`}
          >
            <SelectMenu
              value={preset}
              onChange={setPreset}
              options={[
                ...templatesForDocType(docType),
                ...loadCustomTemplates().map((t) => ({ id: t.id, name: t.name })),
              ].map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
        )}
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {c.logo && (
              <img
                src={c.logo}
                alt="logo"
                className="h-12 w-12 object-contain border border-brand-200 rounded-xl"
              />
            )}
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {c.logo ? "Replace" : "Upload"}
            </button>
            {c.logo && (
              <button
                className="btn-ghost"
                onClick={() => setC({ ...c, logo: undefined })}
              >
                <X size={14} /> Remove
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
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={save}>
          Save Company
        </button>
      </div>
    </Modal>
  );
}
