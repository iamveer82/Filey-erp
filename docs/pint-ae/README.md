# PINT-AE reference and validation

Invoice and credit-note codelists, Schematrons and compiled XSLTs were refreshed
from [Peppol PINT-AE 1.0.4](https://docs.peppol.eu/poac/ae/pint-ae/) on
29 September 2026 using the official `resources.zip`. Previous examples remain
as reference only. `common/docs/bis.pdf` is an older reference; use the current
online specification for implementation.

`src/lib/einvoiceCodes.json` contains the `id` column from the versioned
UNECERec20, eas, ISO3166, ISO4217 and UNCL4461 genericode lists. Do not edit
these generated codes independently of the vendored specification.

## Local checks

The browser performs field and calculation checks without a server request.
Official Schematron checks run separately in development and require Java 11+
and [Saxon-HE 10.9](https://repo.maven.apache.org/maven2/net/sf/saxon/Saxon-HE/10.9/).
The engine is not bundled in Filey.

```powershell
$env:FILEY_PINT_OUTPUT = 'output/uae-einvoice/samples'
npm test -- src/lib/__tests__/einvoice-xml.test.ts
python scripts/validate-pint-ae.py --saxon path/to/Saxon-HE-10.9.jar output/uae-einvoice/samples/invoice.xml
```

For UBL structure checks, install `lxml` in the development Python environment
and pass `--ubl-xsd path/to/xsd`. Use the complete `xsd` directory from
[OASIS UBL 2.1](https://docs.oasis-open.org/ubl/os-UBL-2.1/). The script uses local
files and sends no invoice data over the network. Include the generated
`discounted`, `foreign`, `credit`, `foreignCredit`, `volumeCredit`, `exempt`,
`outOfScope`, `reverse`, `export`, `freezone`, `commercial` and `commercialCredit` samples
in validation before release.

Passing sample checks is not certification. The accredited provider must
validate each actual document against its supported rules before submission.
Deemed-supply, margin, summary, continuous-supply, agent and e-commerce
scenarios are blocked from Filey XML export until their additional required
fields and accounting treatments are implemented and tested. Use the provider's
specialist forms for those scenarios. PDF layout selection never changes the
recorded amount or tax treatment; a margin-style layout alone does not perform
profit-margin tax accounting.

## Implementation status

- Corporate Tax identity, VAT TRN and electronic address are separate fields.
  Invoice parties are snapshots; a saved document retains its UUID.
- The editor, PDF and XML share tax grouping, cent allocation and totals.
  Document discounts, applied advances and rounding appear in XML. Additional
  fees use normal invoice lines; document-level charges are not implemented.
- **Check e-invoice** shows missing fields and exports after local checks.
  Export does not change payment status or claim network delivery/reporting.
- The supported PINT-AE types are tax invoice `380`, commercial invoice `480`,
  tax credit note `381` and commercial credit note `81`. Legacy debit/prepayment
  types remain ordinary document options but are rejected for PINT-AE export.
  Commercial documents restrict lines to exempt, out-of-scope or zero-rated
  categories. Tax invoices/credit notes cannot consist solely of exempt and
  out-of-scope lines. Positive amounts due require a payment due date.
- Free-zone supplies capture the beneficiary TRN/TIN. Exports capture the
  delivery street, city, region and country. Recipient routing explicitly
  selects a registered electronic address, the unregistered export endpoint
  `0235:9900000099`, or the outside-UAE-scope endpoint `0235:9900000098`;
  selecting a country alone never changes the recipient endpoint.
- Exempt lines capture an official exemption reason code. Reverse-charge
  lines capture the goods/services category and GTIN under scheme `0160`,
  and require the buyer VAT TRN. Line details use existing item `custom` JSON;
  beneficiary/delivery details use the existing invoice `einvoice` JSON.
  No new record columns are needed for these additions.
- UAE VAT TRNs must be 15 digits, start with `1` and end with `03`. Foreign
  currency exchange rates allow up to six decimal places. Businesses without
  a VAT TRN can export supported commercial documents using their seller TIN.
- Excel/CSV import groups lines, supports corrections and duplicate checks,
  and saves drafts only. Retrying skips successfully saved drafts.
- Supplier UBL XML can be reviewed as a purchase draft. Unsupported document
  allowances/charges, prepayments or rounding require manual entry instead of
  being discarded. A provider-fed incoming inbox is not connected.
- Sales credit notes reference the original invoice, export as UBL CreditNote,
  and reverse revenue, output VAT and receivables. They do not return stock or
  automatically allocate a credit/refund to the original invoice. Supplier
  credit-note posting remains blocked pending its accounting workflow.
- Each XML download attempts to save a content-hashed copy in **My Files**.
  This is an export archive, not a submitted-document receipt or a legally
  immutable retention system. Offline/signed-out archive attempts are best
  effort; the explicit downloaded file remains the user's copy.

## Deployment and remaining provider work

Apply `supabase/2026-09-29-einvoice-identity.sql` before deploying the frontend.
It adds JSON identity fields and preserves existing cloud invoice UUIDs.
`schema.sql` includes the migration for new installations. Local stores already
retain JSON fields; no destructive local migration is needed.

Do not advertise live UAE submission yet. It needs a selected accredited
provider, its API documentation, sandbox access and registered party details.
With that contract available, implement and verify idempotent submission,
authenticated callbacks, separate delivery/reporting states, safe retries,
incoming invoices and provider receipts. Provider secrets must stay in a
server-side secret store, never in browser code or invoice records. Test only
synthetic invoices in the provider sandbox before enabling live transmission.
