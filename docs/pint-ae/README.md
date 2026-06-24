# PINT-AE specification (vendored)

Source of truth for the UAE Peppol e-invoice format used by `src/lib/einvoice.ts`
and `src/lib/einvoiceXml.ts`.

- **Source:** https://docs.peppol.eu/poac/ae/2025-Q2/pint-ae/
- **Version:** PINT-AE 2025-Q2 (resources.zip)
- **Vendored:** 2026-06-24

## What's here

- `trn-invoice/`, `trn-creditnote/` — per document type:
  - `codelist/*.gc` — genericode code lists (tax category, exemption, transaction
    type, EAS, units, ISO country/currency). The machine "data dictionary".
  - `schematron/*.sch` — business rules (the validation source). ~133 AE rules +
    ~169 UBL rules. Rule IDs like `ibr-104-ae` are quoted in the serializer.
  - `example/*.xml` — conformance examples. `Standard invoice Mandatory fields.xml`
    is the authoritative minimal valid invoice.
- `common/docs/bis.pdf` — human-readable spec / data dictionary.

## Dropped to keep it lean

- `*.xslt` (compiled Schematron) — only needed to *run* validation in-app; the
  accredited service provider runs Schematron, so we don't ship the engine.
- `compliance.pdf`, `specialized-release-notes.pdf` — not needed for the build.

Re-fetch all of it from the source URL's `resources.zip` if needed.
